import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ValidationError } from "@/domain/auth/errors";
import { assessmentDraftResponseSchema, assessmentSubmissionRequestSchema } from "../schemas";
import { deriveAndCreateCompletion } from "../completion/service";
import { startAssignment } from "../assignments/service";
import { reevaluateEmployeeReadinessSafely } from "@/domain/readiness/reevaluation";

type AssistanceContext = { actorUserId?: string; administrative?: boolean; enforceContent?: boolean; assignmentId?: string };

export async function startAttempt(assignmentId: string, employeeId: string, assessmentId: string) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, employeeId } });
  if (!assignment) throw new AuthorizationError("Assessment unavailable");
  return prisma.$transaction(async tx => {
    const assessment = await tx.assessment.findFirst({ where: { id: assessmentId, status: "PUBLISHED", module: { courseVersionId: assignment.courseVersionId }, OR: [{ questionBankVersionId: null }, { questionBankVersion: { questionBank: { courseVersionId: assignment.courseVersionId } } }] }, include: { attempts: { where: { trainingAssignmentId: assignmentId }, include: { draftResponses: true }, orderBy: { attemptNumber: "desc" } } } });
    if (!assessment) throw new AuthorizationError("Assessment unavailable");
    const open = assessment.attempts.find(attempt => !attempt.submittedAt);
    if (open) return open;
    if (assessment.maxAttempts && assessment.attempts.length >= assessment.maxAttempts) throw new AuthorizationError("Maximum attempts reached");
    if (["COMPLETED", "TRAINING_COMPLETE_COMPETENCY_PENDING", "CANCELLED", "SUPERSEDED"].includes(assignment.status)) throw new AuthorizationError("Assessment unavailable");
    if (assignment.status === "NOT_STARTED") await startAssignment(assignmentId, employeeId);
    return tx.assessmentAttempt.create({ data: { organizationId: assignment.organizationId, employeeId, trainingAssignmentId: assignmentId, assessmentId, courseVersionId: assignment.courseVersionId, attemptNumber: assessment.attempts.length + 1 }, include: { draftResponses: true } });
  }, { isolationLevel: "Serializable" });
}

export async function saveAssessmentDraftResponse(attemptId: string, employeeId: string, raw: unknown, context: AssistanceContext = {}) {
  const input = assessmentDraftResponseSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const attempt = await tx.assessmentAttempt.findFirst({ where: { id: attemptId, employeeId, trainingAssignmentId: context.assignmentId, submittedAt: null, trainingAssignment: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] } } } });
    if (!attempt) throw new AuthorizationError("Editable assessment attempt unavailable");
    const question = await tx.assessmentQuestion.findFirst({ where: { id: input.questionId, assessmentId: attempt.assessmentId }, select: { id: true, options: { select: { id: true } } } });
    if (!question) throw new AuthorizationError("Question is not part of this assessment attempt");
    const validOptions = new Set(question.options.map(option => option.id));
    if (input.selectedOptionIds.some(id => !validOptions.has(id))) throw new AuthorizationError("Assessment option does not belong to its question");
    const response = await tx.assessmentDraftResponse.upsert({ where: { attemptId_questionId: { attemptId, questionId: input.questionId } }, create: { attemptId, questionId: input.questionId, selectedOptionIds: input.selectedOptionIds, savedByUserId: context.actorUserId }, update: { selectedOptionIds: input.selectedOptionIds, savedByUserId: context.actorUserId } });
    if (context.administrative && context.actorUserId) {
      await tx.trainingAssignmentEvent.create({ data: { organizationId: attempt.organizationId, assignmentId: attempt.trainingAssignmentId, actorUserId: context.actorUserId, eventType: "TRAINING_RESPONSE_ADMIN_UPDATED", metadata: { attemptId, questionId: input.questionId } } });
      await tx.auditEvent.create({ data: { organizationId: attempt.organizationId, actorUserId: context.actorUserId, employeeId, eventType: "training.response_admin_updated", entityType: "AssessmentAttempt", entityId: attemptId, metadataJson: { assignmentId: attempt.trainingAssignmentId, questionId: input.questionId } } });
    }
    return { id: response.id, attemptId, questionId: response.questionId, selectedOptionIds: response.selectedOptionIds, updatedAt: response.updatedAt };
  });
}

export async function submitAttempt(attemptId: string, employeeId: string, raw: unknown, context: AssistanceContext = {}) {
  const request = assessmentSubmissionRequestSchema.parse(raw);
  const existing = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, employeeId, trainingAssignmentId: context.assignmentId } });
  if (!existing) throw new AuthorizationError("Attempt unavailable");
  if (existing.submittedAt) return existing;
  const result = await prisma.$transaction(async tx => {
    const attempt = await tx.assessmentAttempt.findFirst({ where: { id: attemptId, employeeId, trainingAssignmentId: context.assignmentId, submittedAt: null, trainingAssignment: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] } } }, include: { draftResponses: true, trainingAssignment: { include: { contentProgress: true, acknowledgments: true, courseVersion: { include: { modules: { include: { contentItems: true } } } } } }, assessment: { include: { module: true, questionBankVersion: { include: { questionBank: true } }, questions: { include: { options: true, questionBankVersion: { include: { questionBank: true } } } } } } } });
    if (!attempt || attempt.assessment.module.courseVersionId !== attempt.trainingAssignment.courseVersionId || (attempt.courseVersionId && attempt.courseVersionId !== attempt.trainingAssignment.courseVersionId)) throw new AuthorizationError("Attempt unavailable");
    if (attempt.assessment.questionBankVersion && attempt.assessment.questionBankVersion.questionBank.courseVersionId !== attempt.trainingAssignment.courseVersionId) throw new AuthorizationError("Attempt question bank does not match the pinned course version");
    if (attempt.assessment.questions.some(question => question.questionBankVersion && question.questionBankVersion.questionBank.courseVersionId !== attempt.trainingAssignment.courseVersionId)) throw new AuthorizationError("Attempt contains questions from another course version");
    const completed = new Set(attempt.trainingAssignment.contentProgress.filter(item => item.status === "COMPLETED").map(item => item.contentItemId)), acknowledged = new Set(attempt.trainingAssignment.acknowledgments.map(item => item.contentItemId));
    const missingContent = attempt.trainingAssignment.courseVersion.modules.flatMap(module => module.contentItems).filter(item => item.required && !(item.contentType === "ACKNOWLEDGMENT" ? acknowledged.has(item.id) : completed.has(item.id)));
    if ((context.administrative || context.enforceContent) && missingContent.length) throw new ValidationError("Complete all required instructional content before submitting the assessment", { missingContentItemIds: missingContent.map(item => item.id) });
    if (request.responses) for (const response of request.responses) await tx.assessmentDraftResponse.upsert({ where: { attemptId_questionId: { attemptId, questionId: response.questionId } }, create: { attemptId, questionId: response.questionId, selectedOptionIds: response.selectedOptionIds, savedByUserId: context.actorUserId }, update: { selectedOptionIds: response.selectedOptionIds, savedByUserId: context.actorUserId } });
    const drafts = request.responses ?? (await tx.assessmentDraftResponse.findMany({ where: { attemptId } })).map(response => ({ questionId: response.questionId, selectedOptionIds: response.selectedOptionIds as string[] }));
    const expectedIds = new Set(attempt.assessment.questions.map(question => question.id)), submittedIds = new Set(drafts.map(response => response.questionId));
    if (submittedIds.size !== expectedIds.size || [...submittedIds].some(id => !expectedIds.has(id))) {
      if (request.responses) throw new AuthorizationError("Assessment responses must match the pinned course version");
      throw new ValidationError("Answer every required assessment question before submitting");
    }
    let score = 0, maxScore = 0, criticalMissed = false; const snapshots = [];
    for (const question of attempt.assessment.questions) {
      maxScore += Number(question.points); const response = drafts.find(item => item.questionId === question.id)!;
      const validOptionIds = new Set(question.options.map(option => option.id)); if (response.selectedOptionIds.some(id => !validOptionIds.has(id))) throw new AuthorizationError("Assessment option does not belong to its question");
      const selected = new Set(response.selectedOptionIds), correctIds = new Set(question.options.filter(option => option.isCorrect).map(option => option.id)), correct = selected.size === correctIds.size && [...selected].every(id => correctIds.has(id));
      if (question.critical && !correct) criticalMissed = true; const awarded = correct ? Number(question.points) : 0; score += awarded;
      snapshots.push({ questionId: question.id, prompt: question.prompt, selectedOptionIds: [...selected], correct, awardedPoints: awarded });
      await tx.assessmentResponse.create({ data: { attemptId, questionId: question.id, selectedOptionIds: [...selected], awardedPoints: awarded, correct, resultSnapshot: { prompt: question.prompt, selectedOptionIds: [...selected], correct } as Prisma.InputJsonValue } });
    }
    const percentage = maxScore ? score / maxScore * 100 : 0, passed = percentage >= Number(attempt.assessment.passingScore) && !criticalMissed;
    const finalized = await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { submittedAt: new Date(), score, maxScore, percentage, passed, courseVersionId: attempt.trainingAssignment.courseVersionId, resultSnapshot: { responses: snapshots, passingScore: Number(attempt.assessment.passingScore), criticalQuestionFailed: criticalMissed } as Prisma.InputJsonValue } });
    await tx.trainingAssignmentEvent.create({ data: { organizationId: attempt.organizationId, assignmentId: attempt.trainingAssignmentId, actorUserId: context.actorUserId, eventType: context.administrative ? "TRAINING_SUBMITTED_ON_BEHALF" : "ASSESSMENT_FINALIZED", metadata: { attemptId: attempt.id, assessmentId: attempt.assessmentId, passed, percentage, criticalQuestionFailed: criticalMissed } } });
    if (context.administrative && context.actorUserId) await tx.auditEvent.create({ data: { organizationId: attempt.organizationId, actorUserId: context.actorUserId, employeeId, eventType: "training.submitted_on_behalf", entityType: "AssessmentAttempt", entityId: attempt.id, metadataJson: { assignmentId: attempt.trainingAssignmentId, assessmentId: attempt.assessmentId } } });
    return finalized;
  }, { isolationLevel: "Serializable" });
  await deriveAndCreateCompletion(result.trainingAssignmentId);
  await reevaluateEmployeeReadinessSafely(result.organizationId, result.employeeId, result.passed ? "TRAINING_COMPLETED" : "COMPLIANCE_CHANGED");
  return result;
}
