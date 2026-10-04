import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAssignment } from "@/domain/training/assignments/service";
import { saveAssessmentDraftResponse, startAttempt, submitAttempt } from "@/domain/training/assessments/service";
import { completeContent } from "@/domain/training/progress/service";
import { advanceOwnerContent, getOwnerTrainingAssignment, getTrainingAssignmentDetail, listTrainingOperations, saveOwnerAssessmentResponse, submitOwnerAssessment } from "@/domain/training/operations/service";

describe("production training experience", () => {
  const tag = `training-experience-${Date.now()}`;
  let organizationId = "", otherOrganizationId = "", ownerId = "", employeeUserId = "", employeeId = "", adminId = "", auditorId = "", assignmentId = "", assessmentId = "", attemptId = "", firstContentId = "", videoContentId = "", firstQuestionId = "", secondQuestionId = "", firstCorrectId = "", firstWrongId = "", secondCorrectId = "";

  beforeAll(async () => {
    const [owner, employeeUser, admin, auditor, ownerRole, adminRole, auditorRole] = await Promise.all([
      prisma.user.create({ data: { email: `${tag}-owner@example.test`, status: "ACTIVE" } }), prisma.user.create({ data: { email: `${tag}-employee@example.test`, status: "ACTIVE" } }), prisma.user.create({ data: { email: `${tag}-admin@example.test`, status: "ACTIVE" } }), prisma.user.create({ data: { email: `${tag}-auditor@example.test`, status: "ACTIVE" } }),
      prisma.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } }), prisma.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "COMPLIANCE_ADMIN" } }), prisma.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "AUDITOR" } }),
    ]);
    ownerId = owner.id; employeeUserId = employeeUser.id; adminId = admin.id; auditorId = auditor.id;
    const [organization, other] = await Promise.all([prisma.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }), prisma.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } })]);
    organizationId = organization.id; otherOrganizationId = other.id;
    const [ownerMembership, employeeMembership, adminMembership, auditorMembership, otherOwnerMembership] = await Promise.all([
      prisma.organizationMembership.create({ data: { organizationId, userId: owner.id, status: "ACTIVE" } }), prisma.organizationMembership.create({ data: { organizationId, userId: employeeUser.id, status: "ACTIVE" } }), prisma.organizationMembership.create({ data: { organizationId, userId: admin.id, status: "ACTIVE" } }), prisma.organizationMembership.create({ data: { organizationId, userId: auditor.id, status: "ACTIVE" } }), prisma.organizationMembership.create({ data: { organizationId: other.id, userId: owner.id, status: "ACTIVE" } }),
    ]);
    await prisma.membershipRole.createMany({ data: [{ membershipId: ownerMembership.id, roleDefinitionId: ownerRole.id }, { membershipId: adminMembership.id, roleDefinitionId: adminRole.id }, { membershipId: auditorMembership.id, roleDefinitionId: auditorRole.id }, { membershipId: otherOwnerMembership.id, roleDefinitionId: ownerRole.id }] });
    const employee = await prisma.employee.create({ data: { organizationId, userId: employeeUser.id, firstName: "Resume", lastName: "Learner", employmentStatus: "ACTIVE" } }); employeeId = employee.id;
    const course = await prisma.trainingCourse.create({ data: { organizationId, catalogKey: tag, code: "RESUME-101", title: "Resumable Safety Training", category: "SAFETY", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date("2026-01-01"), contentHash: `${tag}-v1`, modules: { create: { sequence: 1, title: "Safety lesson", moduleType: "MIXED", contentItems: { create: [{ sequence: 1, contentType: "WRITTEN", required: true, payload: { heading: "Scene safety", body: "Review immediate hazards." } }, { sequence: 2, contentType: "VIDEO", required: true, payload: { type: "video", title: "Provider-hosted awareness video", provider: "Authoritative Provider", sourceUrl: "https://example.test/video", completionMode: "LEARNER_ACKNOWLEDGMENT" } }] }, assessments: { create: { versionNumber: 1, title: "Safety assessment", passingScore: 50, maxAttempts: 3, status: "PUBLISHED", questions: { create: [{ sequence: 1, questionType: "SINGLE_CHOICE", prompt: "Choose the safe response", points: 1, critical: true, options: { create: [{ sequence: 1, text: "Safe", isCorrect: true }, { sequence: 2, text: "Unsafe", isCorrect: false }] } }, { sequence: 2, questionType: "TRUE_FALSE", prompt: "Training creates certification", points: 1, options: { create: [{ sequence: 1, text: "True", isCorrect: false }, { sequence: 2, text: "False", isCorrect: true }] } }] } } } } } } } }, include: { versions: { include: { modules: { include: { contentItems: true, assessments: { include: { questions: { include: { options: true } } } } } } } } } });
    const version = course.versions[0], learningModule = version.modules[0], assessment = learningModule.assessments[0]; firstContentId = learningModule.contentItems[0].id; videoContentId = learningModule.contentItems[1].id; assessmentId = assessment.id; firstQuestionId = assessment.questions[0].id; secondQuestionId = assessment.questions[1].id; firstCorrectId = assessment.questions[0].options.find(option => option.isCorrect)!.id; firstWrongId = assessment.questions[0].options.find(option => !option.isCorrect)!.id; secondCorrectId = assessment.questions[1].options.find(option => option.isCorrect)!.id;
    const assignment = await prisma.trainingAssignment.create({ data: { fingerprint: tag, activeKey: `${organizationId}:${employee.id}:${version.id}`, organizationId, employeeId: employee.id, courseVersionId: version.id, sourceType: "MANUAL" } }); assignmentId = assignment.id;
    expect(employeeMembership.status).toBe("ACTIVE");
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("restores legitimate content progress and current draft responses without answer keys", async () => {
    await completeContent(assignmentId, employeeId, firstContentId);
    const attempt = await startAttempt(assignmentId, employeeId, assessmentId); attemptId = attempt.id;
    await expect(saveAssessmentDraftResponse(attempt.id, employeeId, { questionId: firstQuestionId, selectedOptionIds: [firstWrongId] }, { actorUserId: employeeUserId, assignmentId: "wrong-assignment" })).rejects.toThrow(/unavailable/i);
    await saveAssessmentDraftResponse(attempt.id, employeeId, { questionId: firstQuestionId, selectedOptionIds: [firstWrongId] }, { actorUserId: employeeUserId });
    const reopened = await getAssignment(organizationId, employeeId, assignmentId);
    expect(reopened.contentProgress.some(progress => progress.contentItemId === firstContentId && progress.status === "COMPLETED")).toBe(true);
    expect(reopened.attempts[0].draftResponses[0].selectedOptionIds).toEqual([firstWrongId]);
    expect(JSON.stringify(reopened)).not.toContain("isCorrect");
    expect((await startAttempt(assignmentId, employeeId, assessmentId)).id).toBe(attempt.id);
  });

  it("shows the same state to the owner and replaces the current response with an audited admin edit", async () => {
    const ownerView = await getOwnerTrainingAssignment({ id: ownerId }, organizationId, assignmentId);
    expect(ownerView.attempts[0].draftResponses[0].selectedOptionIds).toEqual([firstWrongId]);
    await saveOwnerAssessmentResponse({ id: ownerId }, organizationId, assignmentId, attemptId, { questionId: firstQuestionId, selectedOptionIds: [firstCorrectId] });
    expect(await prisma.assessmentDraftResponse.count({ where: { attemptId, questionId: firstQuestionId } })).toBe(1);
    expect((await prisma.assessmentDraftResponse.findUniqueOrThrow({ where: { attemptId_questionId: { attemptId, questionId: firstQuestionId } } })).selectedOptionIds).toEqual([firstCorrectId]);
    expect((await getAssignment(organizationId, employeeId, assignmentId)).attempts[0].draftResponses[0].selectedOptionIds).toEqual([firstCorrectId]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId, eventType: "training.response_admin_updated" }, orderBy: { occurredAt: "desc" } });
    expect(audit.actorUserId).toBe(ownerId); expect(audit.employeeId).toBe(employeeId); expect(JSON.stringify(audit.metadataJson)).not.toContain(firstWrongId); expect(JSON.stringify(audit.metadataJson)).not.toContain(firstCorrectId);
  });

  it("enforces exact owner-only, tenant, and read-only role boundaries", async () => {
    const before = await Promise.all([prisma.trainingContentProgress.count({ where: { assignmentId } }), prisma.assessmentAttempt.count({ where: { trainingAssignmentId: assignmentId } }), prisma.assessmentDraftResponse.count({ where: { attempt: { trainingAssignmentId: assignmentId } } })]);
    const readOnly = await getTrainingAssignmentDetail({ id: adminId }, organizationId, assignmentId);
    expect(readOnly.id).toBe(assignmentId);
    expect(await Promise.all([prisma.trainingContentProgress.count({ where: { assignmentId } }), prisma.assessmentAttempt.count({ where: { trainingAssignmentId: assignmentId } }), prisma.assessmentDraftResponse.count({ where: { attempt: { trainingAssignmentId: assignmentId } } })])).toEqual(before);
    await expect(getOwnerTrainingAssignment({ id: adminId }, organizationId, assignmentId)).rejects.toThrow(/owner/i);
    await expect(getOwnerTrainingAssignment({ id: auditorId }, organizationId, assignmentId)).rejects.toThrow(/owner/i);
    await expect(getOwnerTrainingAssignment({ id: employeeUserId }, organizationId, assignmentId)).rejects.toThrow(/owner/i);
    await expect(getOwnerTrainingAssignment({ id: ownerId }, otherOrganizationId, assignmentId)).rejects.toThrow(/not found/i);
    await expect(getTrainingAssignmentDetail({ id: ownerId }, otherOrganizationId, assignmentId)).rejects.toThrow(/not found/i);
  });

  it("uses the same prerequisites and lifecycle for owner submission and is retry safe", async () => {
    await expect(submitOwnerAssessment({ id: ownerId }, organizationId, assignmentId, attemptId)).rejects.toThrow(/required instructional content/i);
    await advanceOwnerContent({ id: ownerId }, organizationId, assignmentId, videoContentId);
    await saveAssessmentDraftResponse(attemptId, employeeId, { questionId: secondQuestionId, selectedOptionIds: [secondCorrectId] }, { actorUserId: employeeUserId });
    const result = await submitOwnerAssessment({ id: ownerId }, organizationId, assignmentId, attemptId); expect(result.passed).toBe(true);
    const repeated = await submitAttempt(attemptId, employeeId, {}); expect(repeated.id).toBe(result.id);
    expect(await prisma.assessmentResponse.count({ where: { attemptId } })).toBe(2);
    expect((await getAssignment(organizationId, employeeId, assignmentId)).completion).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId, eventType: "training.submitted_on_behalf", actorUserId: ownerId, employeeId } })).toBe(1);
    expect(await prisma.certificate.count({ where: { organizationId, employeeId } })).toBe(0);
    expect(await prisma.competencyAssessment.count({ where: { organizationId, employeeId } })).toBe(0);
  });

  it("provides human-readable operations and safe media fallbacks", async () => {
    const operations = await listTrainingOperations({ id: ownerId }, organizationId);
    expect(operations.canAssist).toBe(true); expect(operations.items[0]).toMatchObject({ course: { title: "Resumable Safety Training" }, employee: { firstName: "Resume" }, progress: { percentage: 100 }, assessment: { state: "PASSED" } });
    const source = await readFile("src/app/components/training-course-player.tsx", "utf8");
    expect(source).toContain("provider-hosted video"); expect(source).toContain("does not claim playback telemetry"); expect(source).toContain("video source is currently unavailable");
    const operationsSource = await readFile("src/app/admin/operations-portal.tsx", "utf8");
    expect(operationsSource).toContain("No training assignments match this view"); expect(operationsSource).toContain("View / assist"); expect(operationsSource).toContain("View training"); expect(operationsSource).toContain("readOnly={!training.canAssist}"); expect(operationsSource).toContain("Attention or overdue"); expect(operationsSource).not.toContain("Owner assistance required to modify"); expect(operationsSource).not.toContain("<Records rows={courses}");
    const shortcutSource = await readFile("src/app/admin/employee-training-readiness.tsx", "utf8");
    expect(shortcutSource).toContain("/admin/compliance-operations?"); expect(shortcutSource).not.toContain("href={`/admin?");
    await expect(readFile("src/app/admin/compliance-operations/page.tsx", "utf8")).resolves.toContain("EmployerOperationsPortal");
  });
});
