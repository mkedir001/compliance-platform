import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { createManualAssignment, cancelAssignment, deriveAssignmentDisplayStatus, getAssignment, startAssignment } from "@/domain/training/assignments/service";
import { startAttempt, submitAttempt } from "@/domain/training/assessments/service";
import { finalizeTrainingAssignment } from "@/domain/training/completion/service";
import { acknowledgeContent, completeContent } from "@/domain/training/progress/service";

const db = new PrismaClient();

describe.sequential("Phase 7 employee training lifecycle", () => {
  let organizationId: string, otherOrganizationId: string, ownerId: string, learnerUserId: string, employeeId: string, otherEmployeeId: string;

  beforeAll(async () => {
    const northstar = await db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } });
    const lakeside = await db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } });
    const owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } });
    const tag = Date.now();
    const learner = await db.user.create({ data: { email: `phase7-${tag}@example.test`, status: "ACTIVE" } });
    await db.organizationMembership.create({ data: { organizationId: northstar.id, userId: learner.id, status: "ACTIVE" } });
    const employee = await db.employee.create({ data: { organizationId: northstar.id, userId: learner.id, firstName: "Phase", lastName: "Seven", employmentStatus: "ACTIVE" } });
    const otherEmployee = await db.employee.create({ data: { organizationId: lakeside.id, firstName: "Other", lastName: "Tenant", employmentStatus: "ACTIVE" } });
    organizationId = northstar.id; otherOrganizationId = lakeside.id; ownerId = owner.id; learnerUserId = learner.id; employeeId = employee.id; otherEmployeeId = otherEmployee.id;
  });

  it("pins, executes, and finalizes production curriculum without duplicating evidence", async () => {
    const version = await db.trainingCourseVersion.findFirstOrThrow({ where: { status: "ACTIVE", course: { code: "245D-102" } }, include: { modules: { include: { contentItems: true, subjectMappings: true, assessments: { include: { questions: { include: { options: true } } } } } } } });
    const owner = { id: ownerId };
    const first = await createManualAssignment(owner, organizationId, { employeeId, courseVersionId: version.id, dueAt: "2020-01-01T00:00:00.000Z" });
    const duplicate = await createManualAssignment(owner, organizationId, { employeeId, courseVersionId: version.id });
    expect(duplicate.id).toBe(first.id);
    expect(first.courseVersionId).toBe(version.id);
    expect(deriveAssignmentDisplayStatus(first)).toBe("OVERDUE");
    expect(await db.trainingAssignmentEvent.count({ where: { assignmentId: first.id, eventType: "TRAINING_ASSIGNED" } })).toBe(1);
    await expect(getAssignment(otherOrganizationId, otherEmployeeId, first.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(createManualAssignment(owner, organizationId, { employeeId: otherEmployeeId, courseVersionId: version.id })).rejects.toThrow();

    await startAssignment(first.id, employeeId);
    await startAssignment(first.id, employeeId);
    expect(await db.trainingAssignmentEvent.count({ where: { assignmentId: first.id, eventType: "TRAINING_STARTED" } })).toBe(1);
    expect(await finalizeTrainingAssignment(first.id)).toBeNull();

    const foreignVersion = await db.trainingCourseVersion.findFirstOrThrow({ where: { status: "ACTIVE", id: { not: version.id } }, include: { modules: { include: { contentItems: true, assessments: true } } } });
    await expect(completeContent(first.id, employeeId, foreignVersion.modules[0].contentItems[0].id)).rejects.toBeInstanceOf(AuthorizationError);
    if (foreignVersion.modules[0].assessments[0]) await expect(startAttempt(first.id, employeeId, foreignVersion.modules[0].assessments[0].id)).rejects.toBeInstanceOf(AuthorizationError);

    for (const item of version.modules[0].contentItems) {
      if (item.contentType === "ACKNOWLEDGMENT") await acknowledgeContent(first.id, employeeId, learnerUserId, item.id);
      else await completeContent(first.id, employeeId, item.id);
    }
    expect(await finalizeTrainingAssignment(first.id)).toBeNull();
    const assessment = version.modules[0].assessments[0];
    const criticalAttempt = await startAttempt(first.id, employeeId, assessment.id);
    await expect(submitAttempt(criticalAttempt.id, employeeId, { responses: assessment.questions.slice(1).map(q => ({ questionId: q.id, selectedOptionIds: q.options.filter(o => o.isCorrect).map(o => o.id) })) })).rejects.toThrow("pinned course version");
    const failed = await submitAttempt(criticalAttempt.id, employeeId, { responses: assessment.questions.map(q => ({ questionId: q.id, selectedOptionIds: q.options.filter(o => q.critical ? !o.isCorrect : o.isCorrect).map(o => o.id) })) });
    expect(failed.passed).toBe(false);
    expect((failed.resultSnapshot as { criticalQuestionFailed: boolean }).criticalQuestionFailed).toBe(true);
    expect(await finalizeTrainingAssignment(first.id)).toBeNull();

    const passingAttempt = await startAttempt(first.id, employeeId, assessment.id);
    await submitAttempt(passingAttempt.id, employeeId, { responses: assessment.questions.map(q => ({ questionId: q.id, selectedOptionIds: q.options.filter(o => o.isCorrect).map(o => o.id) })) });
    const completion = await finalizeTrainingAssignment(first.id);
    const retried = await finalizeTrainingAssignment(first.id);
    expect(retried?.id).toBe(completion?.id);
    expect((await db.trainingAssignment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("COMPLETED");
    expect(await db.trainingCompletion.count({ where: { assignmentId: first.id } })).toBe(1);
    const evidence = await db.trainingSubjectEvidence.findMany({ where: { trainingCompletionId: completion!.id } });
    expect(evidence.map(x => ({ code: x.subjectAreaCode, minutes: x.minutes }))).toEqual(version.modules[0].subjectMappings.map(x => ({ code: x.subjectAreaCode, minutes: x.minutes })));
    expect(await db.trainingAssignmentEvent.count({ where: { assignmentId: first.id, eventType: "TRAINING_COMPLETED" } })).toBe(1);

    const newest = await db.trainingCourseVersion.aggregate({ where: { courseId: version.courseId }, _max: { versionNumber: true } });
    await db.trainingCourseVersion.create({ data: { courseId: version.courseId, versionNumber: (newest._max.versionNumber ?? 1) + 1, status: "DRAFT", effectiveFrom: new Date("2027-01-01"), contentHash: `phase7-newer-version-${Date.now()}` } });
    const historical = await db.trainingCompletion.findUniqueOrThrow({ where: { assignmentId: first.id }, include: { subjectEvidence: true } });
    expect(historical.courseVersionId).toBe(version.id);
    expect(historical.contentHash).toBe(version.contentHash);
    expect(historical.subjectEvidence).toEqual(evidence);
  }, 30000);

  it("cancels only mutable assignments and permits an intentional reassignment", async () => {
    const version = await db.trainingCourseVersion.findFirstOrThrow({ where: { status: "ACTIVE", course: { code: "245D-103" } } });
    const first = await createManualAssignment({ id: ownerId }, organizationId, { employeeId, courseVersionId: version.id });
    const cancelled = await cancelAssignment({ id: ownerId }, organizationId, first.id, { reason: "Role changed" });
    expect(cancelled.status).toBe("CANCELLED");
    const replacement = await createManualAssignment({ id: ownerId }, organizationId, { employeeId, courseVersionId: version.id });
    expect(replacement.id).not.toBe(first.id);
    await expect(completeContent(first.id, employeeId, (await db.trainingContentItem.findFirstOrThrow({ where: { module: { courseVersionId: version.id } } })).id)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
