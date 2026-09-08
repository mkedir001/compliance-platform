import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/domain/auth/errors";
import { assessmentSubmissionSchema } from "../schemas";
import { deriveAndCreateCompletion } from "../completion/service";
import { startAssignment } from "../assignments/service";

export async function startAttempt(assignmentId: string, employeeId: string, assessmentId: string) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, employeeId } });
  if (!assignment) throw new AuthorizationError("Assessment unavailable");
  return prisma.$transaction(async tx => {
    const assessment = await tx.assessment.findFirst({ where: { id: assessmentId, status: "PUBLISHED", module: { courseVersionId: assignment.courseVersionId }, OR: [{ questionBankVersionId: null }, { questionBankVersion: { questionBank: { courseVersionId: assignment.courseVersionId } } }] }, include: { attempts: { where: { trainingAssignmentId: assignmentId } } } });
    if (!assessment) throw new AuthorizationError("Assessment unavailable");
    if (assessment.maxAttempts && assessment.attempts.length >= assessment.maxAttempts) throw new AuthorizationError("Maximum attempts reached");
    if (["COMPLETED", "TRAINING_COMPLETE_COMPETENCY_PENDING", "CANCELLED", "SUPERSEDED"].includes(assignment.status)) throw new AuthorizationError("Assessment unavailable");
    if (assignment.status === "NOT_STARTED") await startAssignment(assignmentId, employeeId);
    return tx.assessmentAttempt.create({ data: { organizationId: assignment.organizationId, employeeId, trainingAssignmentId: assignmentId, assessmentId, courseVersionId: assignment.courseVersionId, attemptNumber: assessment.attempts.length + 1 } });
  }, { isolationLevel: "Serializable" });
}

export async function submitAttempt(attemptId: string, employeeId: string, input: unknown) {
  const submitted = assessmentSubmissionSchema.parse(input);
  const result = await prisma.$transaction(async tx => {
    const attempt = await tx.assessmentAttempt.findFirst({ where: { id: attemptId, employeeId, submittedAt: null, trainingAssignment: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] } } }, include: { trainingAssignment: true, assessment: { include: { module: true, questionBankVersion: { include: { questionBank: true } }, questions: { include: { options: true, questionBankVersion: { include: { questionBank: true } } } } } } } });
    if (!attempt || attempt.assessment.module.courseVersionId !== attempt.trainingAssignment.courseVersionId || (attempt.courseVersionId && attempt.courseVersionId !== attempt.trainingAssignment.courseVersionId)) throw new AuthorizationError("Attempt unavailable");
    if (attempt.assessment.questionBankVersion && attempt.assessment.questionBankVersion.questionBank.courseVersionId !== attempt.trainingAssignment.courseVersionId) throw new AuthorizationError("Attempt question bank does not match the pinned course version");
    if (attempt.assessment.questions.some(question => question.questionBankVersion && question.questionBankVersion.questionBank.courseVersionId !== attempt.trainingAssignment.courseVersionId)) throw new AuthorizationError("Attempt contains questions from another course version");
    const expectedIds = new Set(attempt.assessment.questions.map(q => q.id));
    const submittedIds = new Set(submitted.responses.map(r => r.questionId));
    if (submittedIds.size !== expectedIds.size || [...submittedIds].some(id => !expectedIds.has(id))) throw new AuthorizationError("Assessment responses must match the pinned course version");
    let score = 0, maxScore = 0, criticalMissed = false;
    const snapshots = [];
    for (const question of attempt.assessment.questions) {
      maxScore += Number(question.points);
      const response = submitted.responses.find(r => r.questionId === question.id)!;
      const validOptionIds = new Set(question.options.map(o => o.id));
      if (response.selectedOptionIds.some(id => !validOptionIds.has(id))) throw new AuthorizationError("Assessment option does not belong to its question");
      const selected = new Set(response.selectedOptionIds);
      const correctIds = new Set(question.options.filter(o => o.isCorrect).map(o => o.id));
      const correct = selected.size === correctIds.size && [...selected].every(id => correctIds.has(id));
      if (question.critical && !correct) criticalMissed = true;
      const awarded = correct ? Number(question.points) : 0;
      score += awarded;
      snapshots.push({ questionId: question.id, prompt: question.prompt, selectedOptionIds: [...selected], correct, awardedPoints: awarded });
      await tx.assessmentResponse.create({ data: { attemptId, questionId: question.id, selectedOptionIds: [...selected], awardedPoints: awarded, correct, resultSnapshot: { prompt: question.prompt, selectedOptionIds: [...selected], correct } as Prisma.InputJsonValue } });
    }
    const percentage = maxScore ? score / maxScore * 100 : 0;
    const passed = percentage >= Number(attempt.assessment.passingScore) && !criticalMissed;
    const completed = await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { submittedAt: new Date(), score, maxScore, percentage, passed, courseVersionId: attempt.trainingAssignment.courseVersionId, resultSnapshot: { responses: snapshots, passingScore: Number(attempt.assessment.passingScore), criticalQuestionFailed: criticalMissed } as Prisma.InputJsonValue } });
    await tx.trainingAssignmentEvent.create({ data: { organizationId: attempt.organizationId, assignmentId: attempt.trainingAssignmentId, eventType: "ASSESSMENT_FINALIZED", metadata: { attemptId: attempt.id, assessmentId: attempt.assessmentId, passed, percentage, criticalQuestionFailed: criticalMissed } } });
    return completed;
  }, { isolationLevel: "Serializable" });
  await deriveAndCreateCompletion(result.trainingAssignmentId);
  return result;
}
