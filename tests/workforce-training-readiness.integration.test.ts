import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { evaluateProposedAssignment } from "@/domain/service-assignments/service";
import {
  assignBaselineTraining,
  getEmployeeTrainingReadiness,
  initializePersonSpecificTraining,
  updateFirstAidReadiness,
  updateMedicationReadiness,
} from "@/domain/workforce/training-readiness";

const db = new PrismaClient();

describe.sequential("workforce training and readiness operations", () => {
  let organizationId = "", otherOrganizationId = "", ownerId = "", outsiderId = "", employeeId = "", evidenceEmployeeId = "", medicationEmployeeId = "", medicationPathwayId = "", medicationDutyId = "";
  const at = new Date("2026-10-03T18:00:00.000Z");
  const owner = () => ({ id: ownerId });
  const evidence = (suffix: string) => ({ providerName: "Synthetic training provider", trainingName: suffix, trainingDate: "2026-09-01", expiresAt: "2027-09-01", credentialNumber: `TEST-${suffix}`, evidenceReference: `secure:test-${suffix}`, notes: "Synthetic non-production evidence." });

  beforeAll(async () => {
    const tag = `workforce-readiness-${Date.now()}`;
    const [organization, otherOrganization, ownerUser, outsider] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `${tag}-owner@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-outsider@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; ownerId = ownerUser.id; outsiderId = outsider.id;
    const membership = await db.organizationMembership.create({ data: { organizationId, userId: ownerId, status: "ACTIVE" } });
    const ownerRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: ownerRole.id } });
    await db.organizationLicense.create({ data: { organizationId, licenseType: "MN_245D", licenseStatus: "ACTIVE", effectiveDate: new Date("2026-08-01"), issuingAuthority: "Synthetic test authority" } });
    const employees = await Promise.all([
      db.employee.create({ data: { organizationId, firstName: "Baseline", lastName: "Worker", employmentStatus: "ACTIVE" } }),
      db.employee.create({ data: { organizationId, firstName: "Evidence", lastName: "Worker", employmentStatus: "ACTIVE" } }),
      db.employee.create({ data: { organizationId, firstName: "Medication", lastName: "Worker", employmentStatus: "ACTIVE" } }),
    ]);
    employeeId = employees[0].id; evidenceEmployeeId = employees[1].id; medicationEmployeeId = employees[2].id;

    const requirement = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-014" } } });
    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${tag}:medication`, code: `${tag}-MED`, title: "Synthetic governed medication training", category: "MEDICATION", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-08-01"), publishedAt: new Date("2026-08-01"), contentHash: `${tag}:medication:v1`, clinicalGovernanceRequired: true } } }, include: { versions: true } });
    const checklist = await db.skillChecklist.create({ data: { organizationId, code: `${tag}-MED`, name: "Synthetic medication observation", ownerType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "ACTIVE", effectiveFrom: new Date("2026-08-01"), contentHash: `${tag}:checklist:v1`, items: { create: { sequence: 1, description: "Synthetic observed step" } } } } }, include: { versions: true } });
    const competency = await db.competencyDefinition.create({ data: { organizationId, code: `${tag}-MED`, name: "Synthetic medication competency", method: "OBSERVED_SKILL", ownerType: "ORGANIZATION" } });
    medicationPathwayId = (await db.medicationQualificationPathway.create({ data: { organizationId, requirementVersionId: requirement.id, courseVersionId: course.versions[0].id, competencyDefinitionId: competency.id, skillChecklistVersionId: checklist.versions[0].id, allowedReviewerCredentialTypes: ["RN"] } })).id;
    medicationDutyId = (await db.dutyDefinition.findUniqueOrThrow({ where: { code: "MEDICATION_ADMINISTRATION" } })).id;
  });

  afterAll(async () => db.$disconnect());

  it("exposes explicit catalog states in the employee-scoped UI", () => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/employee-training-readiness.tsx"), "utf8");
    expect(source).toContain('"idle"|"loading"|"success"|"empty"|"error"');
    expect(source).toContain("Loading catalog…");
    expect(source).toContain("No applicable baseline courses found");
    expect(source).toContain("Catalog unavailable");
    expect(source).toContain("Assign selected baseline training");
  });

  it("loads and idempotently assigns registry-backed baseline training without a client assignment", async () => {
    expect(await db.serviceAssignment.count({ where: { organizationId, employeeId } })).toBe(0);
    const initial = await getEmployeeTrainingReadiness(owner(), organizationId, employeeId, at);
    expect(initial.baseline.licenseTypes).toContain("MN_245D");
    expect(initial.baseline.courses.some(course => course.code === "245D-110")).toBe(true);
    const version = initial.baseline.courses.find(course => course.code === "245D-101")!.versions[0];
    const first = await assignBaselineTraining(owner(), organizationId, employeeId, { courseVersionIds: [version.id] });
    const second = await assignBaselineTraining(owner(), organizationId, employeeId, { courseVersionIds: [version.id] });
    expect(first.assignments[0].id).toBe(second.assignments[0].id);
    expect(second.readiness.baseline.courses.find(course => course.code === "245D-101")!.versions[0].state).toBe("ASSIGNED");
    const courseVersion = await db.trainingCourseVersion.findUniqueOrThrow({ where: { id: version.id } });
    await db.trainingAssignment.update({ where: { id: first.assignments[0].id }, data: { status: "COMPLETED", completedAt: at } });
    await db.trainingCompletion.create({ data: { organizationId, employeeId, assignmentId: first.assignments[0].id, courseId: courseVersion.courseId, courseVersionId: version.id, completedAt: at, completionMethod: "COURSEWORK", evidenceSnapshotJson: { synthetic: true }, contentHash: courseVersion.contentHash } });
    expect((await getEmployeeTrainingReadiness(owner(), organizationId, employeeId, at)).baseline.courses.find(course => course.code === "245D-101")!.versions[0].state).toBe("COMPLETED");
  });

  it("keeps First Aid evidence pending and assigns mapped training when evidence is absent", async () => {
    const submitted = await updateFirstAidReadiness(owner(), organizationId, evidenceEmployeeId, { choice: "ALREADY_HAVE", evidence: evidence("first-aid") });
    expect(submitted.firstAid).toMatchObject({ status: "EVIDENCE_SUBMITTED", evidence: { reviewStatus: "PENDING" } });
    expect(await db.requirementEquivalencyDecision.count({ where: { organizationId, externalTrainingRecordId: submitted.firstAid.evidence!.id } })).toBe(0);
    const assigned = await updateFirstAidReadiness(owner(), organizationId, employeeId, { choice: "NEEDS_TRAINING" });
    expect(assigned.firstAid.status).toBe("NEEDS_TRAINING");
    expect(await db.trainingAssignment.count({ where: { organizationId, employeeId, courseVersion: { course: { code: "245D-110" } } } })).toBe(1);
  });

  it("preserves all three conditional medication paths without granting clinical authority", async () => {
    const submitted = await updateMedicationReadiness(owner(), organizationId, evidenceEmployeeId, { choice: "ALREADY_HAVE", evidence: evidence("medication") });
    expect(submitted.medication).toMatchObject({ status: "EVIDENCE_SUBMITTED", evidence: { reviewStatus: "PENDING" } });
    expect(await db.medicationQualification.count({ where: { organizationId, employeeId: evidenceEmployeeId } })).toBe(0);
    const needsTraining = await updateMedicationReadiness(owner(), organizationId, medicationEmployeeId, { choice: "NEEDS_TRAINING" });
    expect(needsTraining.medication.status).toBe("NEEDS_TRAINING");
    expect(await db.trainingAssignment.count({ where: { organizationId, employeeId: medicationEmployeeId, courseVersionId: needsTraining.medication.pathways[0].courseVersionId } })).toBe(1);
    const notApplicable = await updateMedicationReadiness(owner(), organizationId, employeeId, { choice: "NOT_CURRENTLY_APPLICABLE" });
    expect(notApplicable.medication.status).toBe("NOT_CURRENTLY_APPLICABLE");
    expect(await db.medicationQualification.count({ where: { organizationId, employeeId } })).toBe(0);
  });

  it("leaves Phase 10 authoritative: general work is not medication-blocked, but medication responsibility fails closed", async () => {
    const general = await evaluateProposedAssignment(owner(), organizationId, { employeeId, startsAt: at, blockingScope: "GENERAL_WORK", dutyDefinitionIds: [] });
    expect(general.reasonCodes).not.toEqual(expect.arrayContaining(["MEDICATION_TRAINING_REQUIRED", "CLINICAL_SIGNOFF_REQUIRED", "AUTHORIZATION_REQUIRED"]));
    const medication = await evaluateProposedAssignment(owner(), organizationId, { employeeId, startsAt: at, blockingScope: "MEDICATION_ADMINISTRATION", medicationPathwayId, dutyDefinitionIds: [medicationDutyId], serviceRecipientRef: "synthetic-person" });
    expect(medication.eligible).toBe(false);
    expect(medication.reasonCodes).toContain("MEDICATION_TRAINING_REQUIRED");
  });

  it("derives reviewable person-specific requirements from configured structured assignment rules", async () => {
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Synthetic", legalLastName: "Person", dateOfBirth: new Date("1990-01-01"), createdByUserId: ownerId } });
    const requirement = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-013" } } });
    const rule = await db.serviceAssignmentRequirementRule.create({ data: { organizationId, name: "Person-specific healthy relationships instruction", serviceRecipientRef: client.id, requirementVersionId: requirement.id, blockingScope: "PERSON_SPECIFIC_TASK" } });
    const service = await db.serviceAssignment.create({ data: { organizationId, employeeId, serviceRecipientRef: client.id, startsAt: new Date("2026-10-01"), status: "PROPOSED", blockingScope: "PERSON_SPECIFIC_TASK", createdByUserId: ownerId } });
    const readiness = await getEmployeeTrainingReadiness(owner(), organizationId, employeeId, at), projected = readiness.personSpecific.assignments.find(row => row.serviceAssignmentId === service.id)!;
    expect(projected.personName).toBe("Synthetic Person");
    expect(projected.requirements[0]).toMatchObject({ ruleId: rule.id, requirementCode: "245D-WF-013" });
    expect(projected.requirements[0].course?.code).toBe("245D-111");
    const initialized = await initializePersonSpecificTraining(owner(), organizationId, employeeId, { serviceAssignmentIds: [service.id] });
    expect(initialized.created).toHaveLength(1);
    expect(await db.complianceInstance.count({ where: { organizationId, employeeId, triggerReference: service.id, requirementVersionId: requirement.id } })).toBe(1);
    expect(await db.trainingAssignment.count({ where: { organizationId, employeeId, courseVersion: { course: { code: "245D-111" } } } })).toBe(1);
  });

  it("enforces tenant and role boundaries", async () => {
    await expect(getEmployeeTrainingReadiness({ id: outsiderId }, organizationId, employeeId, at)).rejects.toThrow();
    await expect(getEmployeeTrainingReadiness(owner(), otherOrganizationId, employeeId, at)).rejects.toThrow();
    await expect(assignBaselineTraining({ id: outsiderId }, organizationId, employeeId, { courseVersionIds: [] })).rejects.toThrow();
  });
});
