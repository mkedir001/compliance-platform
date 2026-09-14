import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type ComplianceStatus } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { deriveTemporalStatus } from "@/domain/compliance/operations/deadlines";
import { computeEmployeeOperationalProfile, evaluateEmployeeOperations, evaluateServiceEligibility, executeRemediation, getEmployeeOperationalProfile, getOrganizationComplianceOperations } from "@/domain/compliance/operations/service";

const db = new PrismaClient();
const at = new Date("2026-09-14T17:00:00Z");
let organizationId: string, otherOrganizationId: string, ownerId: string, rulesetId: string, productionVersionId: string, sequence = 0;

async function employee(organization = organizationId) {
  sequence += 1;
  return db.employee.create({ data: { organizationId: organization, employeeNumber: `P8-${Date.now()}-${sequence}`, firstName: "Phase", lastName: `Eight ${sequence}`, employmentStatus: "ACTIVE", hireDate: new Date("2026-01-01"), employmentType: "FULL_TIME" } });
}

async function instance(employeeId: string, input: { status?: ComplianceStatus; dueAt?: Date; blockingScope?: "GENERAL_WORK" | "DIRECT_CONTACT" | "MEDICATION_ADMINISTRATION"; competency?: boolean; training?: boolean } = {}) {
  sequence += 1;
  const requirement = await db.complianceRequirement.create({ data: { code: `P8-REQ-${Date.now()}-${sequence}`, name: `Phase 8 requirement ${sequence}`, licenseType: "MN_245D", requirementCategory: "WORKFORCE" } });
  const version = await db.complianceRequirementVersion.create({ data: { requirementId: requirement.id, versionNumber: 1, effectiveFrom: new Date("2026-01-01"), verificationStatus: "PRIMARY_SOURCE_VERIFIED", status: "ACTIVE", applicabilityDefinition: { schemaVersion: 1, all: [{ type: "ALWAYS" }] }, triggerDefinition: { schemaVersion: 1, type: "FIXED_REQUIREMENT", fixedAt: "2026-01-01T00:00:00Z" }, deadlineDefinition: { schemaVersion: 1, type: "NO_FIXED_DEADLINE" }, competencyDefinition: input.competency ? { schemaVersion: 1, type: "REQUIRED", requirements: ["OBSERVED_SKILL"] } : { schemaVersion: 1, type: "NONE" }, blockingScope: input.blockingScope, trainingOptions: input.training ? { create: { trainingCourseVersionId: productionVersionId, satisfactionType: input.competency ? "TRAINING_AND_COMPETENCY" : "TRAINING_ONLY", isDefault: true } } : undefined } });
  const compliance = await db.complianceInstance.create({ data: { fingerprint: `p8:${employeeId}:${version.id}`, organizationId, employeeId, requirementVersionId: version.id, triggerType: "FIXED_REQUIREMENT", requiredAt: new Date("2026-01-01"), nominalDueAt: input.dueAt, hardBlockAt: input.blockingScope && input.dueAt ? input.dueAt : null, status: input.status ?? "REQUIRED", lastEvaluatedAt: at, rulesetId } });
  return { compliance, version };
}

beforeAll(async () => {
  const [organization, other, owner, ruleset, production] = await Promise.all([
    db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } }),
    db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } }),
    db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }),
    db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE", licenseType: "MN_245D" } }),
    db.trainingCourseVersion.findFirstOrThrow({ where: { status: "ACTIVE", course: { code: "245D-102" } } }),
  ]);
  organizationId = organization.id; otherOrganizationId = other.id; ownerId = owner.id; rulesetId = ruleset.id; productionVersionId = production.id;
});

describe.sequential("Phase 8 compliance operations", () => {
  it("centralizes timezone-aware due, overdue, expiring-soon, and expired derivation", () => {
    expect(deriveTemporalStatus({ dueAt: at, evaluatedAt: at, timeZone: "America/Chicago" })).toBe("DUE");
    expect(deriveTemporalStatus({ dueAt: new Date("2026-09-12"), evaluatedAt: at, timeZone: "America/Chicago" })).toBe("OVERDUE");
    expect(deriveTemporalStatus({ expiresAt: new Date("2026-09-24"), evaluatedAt: at, timeZone: "America/Chicago" })).toBe("EXPIRING_SOON");
    expect(deriveTemporalStatus({ expiresAt: new Date("2026-09-01"), evaluatedAt: at, timeZone: "America/Chicago" })).toBe("EXPIRED");
  });

  it("derives ready, overdue, and deterministic blocking requirement states", async () => {
    const readyEmployee = await employee(), overdueEmployee = await employee();
    await instance(readyEmployee.id, { status: "SATISFIED" });
    const overdue = await instance(overdueEmployee.id, { status: "PAST_DUE", dueAt: new Date("2026-09-01"), blockingScope: "DIRECT_CONTACT" });
    expect((await computeEmployeeOperationalProfile(organizationId, readyEmployee.id, at)).overallStatus).toBe("READY");
    const profile = await computeEmployeeOperationalProfile(organizationId, overdueEmployee.id, at);
    expect(profile.requirements[0]).toMatchObject({ requirementVersionId: overdue.version.id, status: "BLOCKED", blocking: true });
    const decision = await evaluateServiceEligibility({ id: ownerId }, organizationId, overdueEmployee.id, "DIRECT_CONTACT", at);
    expect(decision.eligible).toBe(false);
    expect(decision.blockingRequirements).toContain(overdue.version.id);
    expect(decision.reasonCodes).toContain("REQUIREMENT_BLOCKED");
  });

  it("derives missing, incomplete, and failed-training remediation", async () => {
    const target = await employee();
    const required = await instance(target.id, { training: true });
    let profile = await computeEmployeeOperationalProfile(organizationId, target.id, at);
    expect(profile.remediations.some(action => action.type === "ASSIGN_REQUIRED_TRAINING" && action.executable)).toBe(true);
    const assignment = await executeRemediation({ id: ownerId }, organizationId, target.id, required.compliance.id, "ASSIGN_REQUIRED_TRAINING");
    const retried = await executeRemediation({ id: ownerId }, organizationId, target.id, required.compliance.id, "ASSIGN_REQUIRED_TRAINING");
    expect(retried.id).toBe(assignment.id);
    expect(assignment.courseVersionId).toBe(productionVersionId);
    profile = await computeEmployeeOperationalProfile(organizationId, target.id, at);
    expect(profile.remediations.some(action => action.type === "RESUME_INCOMPLETE_TRAINING")).toBe(true);
    const assessment = await db.assessment.findFirstOrThrow({ where: { module: { courseVersionId: productionVersionId } } });
    await db.assessmentAttempt.create({ data: { organizationId, employeeId: target.id, trainingAssignmentId: assignment.id, assessmentId: assessment.id, courseVersionId: productionVersionId, attemptNumber: 1, submittedAt: at, score: 0, maxScore: 5, percentage: 0, passed: false } });
    profile = await computeEmployeeOperationalProfile(organizationId, target.id, at);
    expect(profile.remediations.some(action => action.type === "RETAKE_FAILED_ASSESSMENT")).toBe(true);
  });

  it("derives competency remediation without fabricating evidence", async () => {
    const target = await employee();
    const required = await instance(target.id, { training: true, competency: true, blockingScope: "GENERAL_WORK" });
    const assignment = await executeRemediation({ id: ownerId }, organizationId, target.id, required.compliance.id, "ASSIGN_REQUIRED_TRAINING");
    const version = await db.trainingCourseVersion.findUniqueOrThrow({ where: { id: productionVersionId } });
    const completion = await db.trainingCompletion.create({ data: { organizationId, employeeId: target.id, assignmentId: assignment.id, courseId: version.courseId, courseVersionId: version.id, completedAt: at, completionMethod: "COURSEWORK", evidenceSnapshotJson: {}, contentHash: version.contentHash } });
    await db.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "TRAINING_COMPLETE_COMPETENCY_PENDING", completedAt: at } });
    await db.complianceInstanceEvidence.create({ data: { complianceInstanceId: required.compliance.id, evidenceType: "TRAINING_COMPLETION", evidenceReferenceId: completion.id } });
    const profile = await computeEmployeeOperationalProfile(organizationId, target.id, at);
    expect(profile.remediations.map(action => action.type)).toEqual(expect.arrayContaining(["COMPLETE_COMPETENCY_ASSESSMENT", "OBTAIN_ASSESSOR_SIGN_OFF"]));
  });

  it("derives expired and expiring evidence without mutating historical evidence", async () => {
    const expiredEmployee = await employee(), expiringEmployee = await employee();
    const expiredRequirement = await instance(expiredEmployee.id, { status: "SATISFIED", blockingScope: "GENERAL_WORK" });
    const expiringRequirement = await instance(expiringEmployee.id, { status: "SATISFIED" });
    for (const [target, requirement, expiresAt] of [[expiredEmployee, expiredRequirement, new Date("2026-09-01")], [expiringEmployee, expiringRequirement, new Date("2026-09-24")]] as const) {
      const credential = await db.professionalCredential.create({ data: { organizationId, employeeId: target.id, credentialType: "OTHER", credentialName: "Operational evidence", expiresAt, verificationStatus: "VERIFIED", verifiedAt: new Date("2026-01-01"), status: "ACTIVE" } });
      await db.complianceInstanceEvidence.create({ data: { complianceInstanceId: requirement.compliance.id, evidenceType: "EXTERNAL_CREDENTIAL", evidenceReferenceId: credential.id } });
    }
    expect((await computeEmployeeOperationalProfile(organizationId, expiredEmployee.id, at)).requirements[0].status).toBe("BLOCKED");
    expect((await computeEmployeeOperationalProfile(organizationId, expiringEmployee.id, at)).requirements[0].status).toBe("EXPIRING_SOON");
    expect((await db.professionalCredential.findMany({ where: { employeeId: { in: [expiredEmployee.id, expiringEmployee.id] } } })).every(item => item.status === "ACTIVE")).toBe(true);
  });

  it("surfaces policy and onboarding deficiencies and preserves the medication authorization boundary", async () => {
    const blocked = await db.employee.findFirstOrThrow({ where: { organizationId, employeeNumber: "1002" } });
    const profile = await getEmployeeOperationalProfile({ id: ownerId }, organizationId, blocked.id, at);
    expect(profile.remediations.map(action => action.type)).toEqual(expect.arrayContaining(["ACKNOWLEDGE_REQUIRED_POLICY", "COMPLETE_ONBOARDING_STEP"]));
    const medication = await evaluateServiceEligibility({ id: ownerId }, organizationId, blocked.id, "MEDICATION_ADMINISTRATION", at);
    expect(medication.eligible).toBe(false);
    expect(medication.reasonCodes).toContain("EVIDENCE_COMPLETE_AUTHORIZATION_NOT_IMPLEMENTED");
  });

  it("creates immutable, repeatable evaluation snapshots and organization counts", async () => {
    const target = await employee();
    const first = await evaluateEmployeeOperations({ id: ownerId }, organizationId, target.id, at);
    const before = await db.workReadinessEvaluation.findUniqueOrThrow({ where: { id: first.snapshotId } });
    const second = await evaluateEmployeeOperations({ id: ownerId }, organizationId, target.id, at);
    const after = await db.workReadinessEvaluation.findUniqueOrThrow({ where: { id: first.snapshotId } });
    expect(second.profile.overallStatus).toBe(first.profile.overallStatus);
    expect(after.resultJson).toEqual(before.resultJson);
    expect(second.snapshotId).not.toBe(first.snapshotId);
    const summary = await getOrganizationComplianceOperations({ id: ownerId }, organizationId, {}, at);
    expect(summary.counts.totalWorkforce).toBeGreaterThan(0);
    expect(summary.workers.some(worker => worker.employee.id === target.id)).toBe(true);
  });

  it("rejects cross-tenant operational reads, remediation, eligibility, and evidence access", async () => {
    const otherEmployee = await employee(otherOrganizationId);
    await expect(getEmployeeOperationalProfile({ id: ownerId }, otherOrganizationId, otherEmployee.id, at)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(evaluateServiceEligibility({ id: ownerId }, otherOrganizationId, otherEmployee.id, "GENERAL_WORK", at)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(executeRemediation({ id: ownerId }, otherOrganizationId, otherEmployee.id, "missing", "ASSIGN_REQUIRED_TRAINING")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getOrganizationComplianceOperations({ id: ownerId }, otherOrganizationId, {}, at)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
