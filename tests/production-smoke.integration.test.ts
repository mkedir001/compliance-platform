import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getEmployeeComplianceReport, getTrainingReport } from "@/domain/reporting/service";
import { startAttempt, submitAttempt } from "@/domain/training/assessments/service";
import { assignTrainingForCompliance, startAssignment } from "@/domain/training/assignments/service";
import { finalizeTrainingAssignment } from "@/domain/training/completion/service";
import { acknowledgeContent, completeContent } from "@/domain/training/progress/service";

const db = new PrismaClient();
describe.sequential("Phase 23 production smoke workflow", () => {
  it("flows from administrator setup through employee completion to authoritative reporting", async () => {
    const tag = `smoke-${Date.now()}`, organization = await db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } }), owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }), learner = await db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } });
    await db.organizationMembership.create({ data: { organizationId: organization.id, userId: learner.id, status: "ACTIVE" } });
    const employee = await db.employee.create({ data: { organizationId: organization.id, userId: learner.id, firstName: "Production", lastName: "Smoke", employmentStatus: "ACTIVE" } });
    const option = await db.requirementTrainingOption.findFirstOrThrow({ where: { trainingCourseVersion: { status: "ACTIVE", course: { code: "245D-101" } } }, include: { trainingCourseVersion: { include: { modules: { orderBy: { sequence: "asc" }, include: { contentItems: { orderBy: { sequence: "asc" } }, assessments: { where: { status: "PUBLISHED" }, include: { questions: { include: { options: true } } } } } } } } } });
    const ruleset = await db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE", requirements: { some: { requirementVersionId: option.complianceRequirementVersionId } } } });
    const instance = await db.complianceInstance.create({ data: { fingerprint: `${tag}:instance`, organizationId: organization.id, employeeId: employee.id, requirementVersionId: option.complianceRequirementVersionId, rulesetId: ruleset.id, triggerType: "EMPLOYEE_HIRED", requiredAt: new Date(), status: "REQUIRED", lastEvaluatedAt: new Date() } });
    const assignment = await assignTrainingForCompliance(instance.id); expect(assignment).toBeTruthy(); await startAssignment(assignment!.id, employee.id, learner.id);
    for (const courseModule of option.trainingCourseVersion.modules) {
      for (const item of courseModule.contentItems) if (item.contentType === "ACKNOWLEDGMENT") await acknowledgeContent(assignment!.id, employee.id, learner.id, item.id); else await completeContent(assignment!.id, employee.id, item.id);
      for (const assessment of courseModule.assessments) { const attempt = await startAttempt(assignment!.id, employee.id, assessment.id); await submitAttempt(attempt.id, employee.id, { responses: assessment.questions.map(question => ({ questionId: question.id, selectedOptionIds: question.options.filter(item => item.isCorrect).map(item => item.id) })) }); }
    }
    const completion = await finalizeTrainingAssignment(assignment!.id); expect(completion).toBeTruthy(); expect((await db.complianceInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe("SATISFIED");
    const training = await getTrainingReport(owner, organization.id, { employeeId: employee.id }), record = await getEmployeeComplianceReport(owner, organization.id, employee.id);
    expect(training.items[0].completion?.id).toBe(completion!.id); expect(record.regulatoryApplicability[0].status).toBe("SATISFIED"); expect(record.training[0].courseVersionId).toBe(option.trainingCourseVersionId);
  }, 30000);
});
