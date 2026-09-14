import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { validateCourseVersion } from "@/domain/training/curriculum/service";
import {
  approveClinicalCurriculum,
  assignMedicationTraining,
  computeMedicationQualification,
  createMedicationObservedAssessment,
  evaluateMedicationDutyEligibility,
  finalizeMedicationObservedAssessment,
  getMedicationEvidence,
  recordMedicationAuthorization,
  recordPersonSpecificInstruction,
  signoffMedicationQualification,
} from "@/domain/medication/service";

const db = new PrismaClient();

describe.sequential("Phase 9 medication clinical governance", () => {
  let organizationId: string, otherOrganizationId: string, ownerId: string, clinicianId: string, credentialId: string, employeeId: string;
  let pathwayId: string, courseId: string, courseVersionId: string, checklistId: string, checklistItemId: string, assignmentId: string, completionId: string;

  beforeAll(async () => {
    const tag = `phase9-${Date.now()}`;
    const [organization, otherOrganization, owner, clinician, learner] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `${tag}-owner@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-rn@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-learner@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; ownerId = owner.id; clinicianId = clinician.id;
    const [ownerMembership, clinicianMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: owner.id, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: clinician.id, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: learner.id, status: "ACTIVE" } }),
    ]);
    const [ownerRole, clinicalRole] = await Promise.all([
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "CLINICAL_RN" } }),
    ]);
    await db.membershipRole.createMany({ data: [{ membershipId: ownerMembership.id, roleDefinitionId: ownerRole.id }, { membershipId: clinicianMembership.id, roleDefinitionId: clinicalRole.id }] });
    const employee = await db.employee.create({ data: { organizationId, userId: learner.id, firstName: "Medication", lastName: "Learner", employmentStatus: "ACTIVE" } }); employeeId = employee.id;
    const credential = await db.professionalCredential.create({ data: { organizationId, userId: clinician.id, credentialType: "RN", credentialName: "Registered Nurse", licenseNumber: "TEST-ONLY", jurisdiction: "MN", verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: owner.id, evidenceReference: "test-fixture", status: "ACTIVE" } }); credentialId = credential.id;

    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${tag}:medication`, code: "TEST-MED", title: "Test-only medication workflow", category: "MEDICATION", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date(), contentHash: `${tag}-course-v1`, clinicalGovernanceRequired: true, modules: { create: { sequence: 1, title: "Test module", moduleType: "ASSESSMENT", subjectMappings: { create: { subjectAreaCode: "MEDICATION", subjectAreaName: "Medication administration", minutes: 15 } }, contentItems: { create: { sequence: 1, contentType: "WRITTEN", payload: { body: "Synthetic test content" } } }, assessments: { create: { versionNumber: 1, title: "Knowledge", passingScore: 80, status: "PUBLISHED" } } } } } } }, include: { versions: { include: { modules: { include: { assessments: true } } } } } });
    courseId = course.id; courseVersionId = course.versions[0].id;
    const checklist = await db.skillChecklist.create({ data: { organizationId, code: "TEST-MED", name: "Test-only medication checklist", ownerType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "ACTIVE", contentHash: `${tag}-checklist-v1`, items: { create: [{ sequence: 1, description: "Synthetic required observation", required: true }, { sequence: 2, description: "Synthetic critical observation", required: true, criticalFailure: true }] } } } }, include: { versions: { include: { items: true } } } });
    checklistId = checklist.versions[0].id; checklistItemId = checklist.versions[0].items[0].id;
    const competency = await db.competencyDefinition.create({ data: { organizationId, code: "TEST-MED", name: "Test-only medication observed skill", method: "OBSERVED_SKILL", ownerType: "ORGANIZATION" } });
    const requirementVersion = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-014" } } });
    const pathway = await db.medicationQualificationPathway.create({ data: { organizationId, requirementVersionId: requirementVersion.id, courseVersionId, competencyDefinitionId: competency.id, skillChecklistVersionId: checklistId, allowedReviewerCredentialTypes: ["RN"], validityDays: null } }); pathwayId = pathway.id;
    const assignment = await db.trainingAssignment.create({ data: { fingerprint: `${tag}:completed`, activeKey: `${organizationId}:${employeeId}:${courseVersionId}`, organizationId, employeeId, courseVersionId, sourceType: "MANUAL", status: "COMPLETED", assignedByUserId: owner.id, completedAt: new Date() } }); assignmentId = assignment.id;
    const assessment = course.versions[0].modules[0].assessments[0];
    const attempt = await db.assessmentAttempt.create({ data: { organizationId, employeeId, trainingAssignmentId: assignment.id, assessmentId: assessment.id, courseVersionId, attemptNumber: 1, submittedAt: new Date(), score: 1, maxScore: 1, percentage: 100, passed: true, resultSnapshot: { passed: true } } });
    const completion = await db.trainingCompletion.create({ data: { organizationId, employeeId, assignmentId: assignment.id, courseId, courseVersionId, completedAt: new Date(), completionMethod: "COURSEWORK", finalAssessmentAttemptId: attempt.id, evidenceSnapshotJson: { courseVersionId }, contentHash: course.versions[0].contentHash, subjectEvidence: { create: { organizationId, subjectAreaCode: "MEDICATION", subjectAreaName: "Medication administration", minutes: 15 } } } }); completionId = completion.id;
  });

  it("requires exact clinical curriculum approval and rejects ordinary administrators", async () => {
    expect((await validateCourseVersion(courseVersionId)).errors.map(error => error.code)).toContain("CLINICAL_APPROVAL_REQUIRED");
    await expect(approveClinicalCurriculum({ id: ownerId }, organizationId, courseVersionId, { credentialId, typedName: "Tenant Owner", statement: "I approve this clinical curriculum." })).rejects.toBeInstanceOf(AuthorizationError);
    await approveClinicalCurriculum({ id: clinicianId }, organizationId, courseVersionId, { credentialId, typedName: "Clinical Reviewer", statement: "I clinically approve this exact test curriculum version." });
    expect((await validateCourseVersion(courseVersionId)).errors.map(error => error.code)).not.toContain("CLINICAL_APPROVAL_REQUIRED");
  });

  it("keeps course and knowledge completion short of governed qualification and pins remediation assignment", async () => {
    const state = await computeMedicationQualification(organizationId, employeeId, pathwayId);
    expect(state.state).toBe("SKILL_ASSESSMENT_REQUIRED");
    expect(state.qualification).toBeNull();
    const first = await assignMedicationTraining({ id: ownerId }, organizationId, employeeId, pathwayId), second = await assignMedicationTraining({ id: ownerId }, organizationId, employeeId, pathwayId);
    expect(first.id).toBe(assignmentId); expect(second.id).toBe(first.id); expect(first.courseVersionId).toBe(courseVersionId);
  });

  it("requires an authorized assessor, blocks failed skill, then permits immutable sign-off", async () => {
    await expect(createMedicationObservedAssessment({ id: ownerId }, organizationId, employeeId, { pathwayId, trainingAssignmentId: assignmentId, credentialId })).rejects.toBeInstanceOf(AuthorizationError);
    const failed = await createMedicationObservedAssessment({ id: clinicianId }, organizationId, employeeId, { pathwayId, trainingAssignmentId: assignmentId, credentialId });
    const items = await db.skillChecklistItem.findMany({ where: { skillChecklistVersionId: checklistId }, orderBy: { sequence: "asc" } });
    await finalizeMedicationObservedAssessment({ id: clinicianId }, organizationId, failed.id, { credentialId, typedName: "Clinical Reviewer", statement: "I attest to this observed skill result.", items: items.map((item, index) => ({ skillChecklistItemId: item.id, result: index ? "FAIL" : "PASS" })) });
    expect((await computeMedicationQualification(organizationId, employeeId, pathwayId)).state).toBe("SKILL_ASSESSMENT_FAILED");
    await expect(signoffMedicationQualification({ id: ownerId }, organizationId, employeeId, { pathwayId, trainingCompletionId: completionId, competencyAssessmentId: failed.id, credentialId, typedName: "Tenant Owner", statement: "I approve this medication qualification.", decision: "APPROVED" })).rejects.toBeInstanceOf(AuthorizationError);
    const passed = await createMedicationObservedAssessment({ id: clinicianId }, organizationId, employeeId, { pathwayId, trainingAssignmentId: assignmentId, credentialId });
    await finalizeMedicationObservedAssessment({ id: clinicianId }, organizationId, passed.id, { credentialId, typedName: "Clinical Reviewer", statement: "I attest to this passing observed skill result.", items: items.map(item => ({ skillChecklistItemId: item.id, result: "PASS" })) });
    expect((await computeMedicationQualification(organizationId, employeeId, pathwayId)).state).toBe("CLINICAL_SIGNOFF_REQUIRED");
    const qualification = await signoffMedicationQualification({ id: clinicianId }, organizationId, employeeId, { pathwayId, trainingCompletionId: completionId, competencyAssessmentId: passed.id, credentialId, typedName: "Clinical Reviewer", statement: "I approve this governed medication training qualification.", decision: "APPROVED" });
    expect(qualification.courseVersionId).toBe(courseVersionId); expect(qualification.skillChecklistVersionId).toBe(checklistId); expect(qualification.validUntil).toBeNull();
    await db.trainingCourseVersion.create({ data: { courseId, versionNumber: 2, status: "DRAFT", effectiveFrom: new Date("2027-01-01"), contentHash: "later-course-version", clinicalGovernanceRequired: true } });
    const parent = await db.skillChecklistVersion.findUniqueOrThrow({ where: { id: checklistId } });
    await db.skillChecklistVersion.create({ data: { skillChecklistId: parent.skillChecklistId, versionNumber: 2, status: "DRAFT", contentHash: "later-checklist-version", items: { create: { sequence: 1, description: "Later synthetic item" } } } });
    const historical = await db.medicationQualification.findUniqueOrThrow({ where: { id: qualification.id }, include: { competencyAssessment: true } });
    expect(historical.courseVersionId).toBe(courseVersionId); expect(historical.skillChecklistVersionId).toBe(checklistId); expect(historical.competencyAssessment.skillChecklistVersionId).toBe(checklistId);
    expect(await db.trainingSubjectEvidence.count({ where: { trainingCompletionId: completionId, subjectAreaCode: "MEDICATION", minutes: 15 } })).toBe(1);
  });

  it("keeps qualification separate from person-specific readiness and authorization", async () => {
    const clinician = { id: clinicianId }, recipient = "opaque-recipient-test-ref";
    const withoutInstruction = await evaluateMedicationDutyEligibility(clinician, organizationId, employeeId, pathwayId, recipient);
    expect(withoutInstruction.eligible).toBe(false); expect(withoutInstruction.reasonCodes).toContain("PERSON_SPECIFIC_INSTRUCTION_REQUIRED"); expect(withoutInstruction.reasonCodes).toContain("AUTHORIZATION_REQUIRED");
    await recordPersonSpecificInstruction(clinician, organizationId, employeeId, { serviceRecipientRef: recipient, procedureReference: "test-procedure", procedureVersion: "v1", credentialId, instructedAt: new Date(), effectiveFrom: new Date("2026-01-01"), typedName: "Clinical Reviewer", statement: "I attest that person-specific test instruction occurred." });
    expect((await evaluateMedicationDutyEligibility(clinician, organizationId, employeeId, pathwayId, recipient)).reasonCodes).toContain("AUTHORIZATION_REQUIRED");
    await recordMedicationAuthorization(clinician, organizationId, employeeId, { serviceRecipientRef: recipient, authorizationType: "AUTHORIZATION", sourceReference: "written-test-authorization", credentialId, effectiveFrom: new Date("2026-01-01"), typedName: "Clinical Reviewer", statement: "I attest that this external authorization evidence was reviewed." });
    const duty = await db.dutyDefinition.findUniqueOrThrow({ where: { code: "MEDICATION_ADMINISTRATION" } });
    await db.employeeDuty.create({ data: { employeeId, dutyDefinitionId: duty.id, effectiveFrom: new Date("2026-01-01"), source: "test assignment" } });
    const eligible = await evaluateMedicationDutyEligibility(clinician, organizationId, employeeId, pathwayId, recipient);
    expect(eligible.eligible).toBe(true); expect(eligible.reasonCodes).toEqual([]);
    expect(await db.medicationAuthorizationEvidence.count({ where: { organizationId, employeeId } })).toBe(1);
    expect(await db.clinicalGovernanceEvent.count({ where: { organizationId, action: { in: ["clinical_curriculum.approved", "medication_skill_assessment.finalized", "medication_qualification.signed_off", "medication_instruction.recorded", "medication_authorization.recorded"] } } })).toBeGreaterThanOrEqual(5);
  });

  it("enforces tenant boundaries for reads and clinical actions", async () => {
    const clinician = { id: clinicianId };
    await expect(getMedicationEvidence(clinician, otherOrganizationId, employeeId)).rejects.toThrow();
    await expect(createMedicationObservedAssessment(clinician, otherOrganizationId, employeeId, { pathwayId, trainingAssignmentId: assignmentId, credentialId })).rejects.toThrow();
    await expect(signoffMedicationQualification(clinician, otherOrganizationId, employeeId, { pathwayId, trainingCompletionId: completionId, competencyAssessmentId: checklistItemId, credentialId, typedName: "Clinical Reviewer", statement: "This cross-tenant action must not succeed.", decision: "APPROVED" })).rejects.toThrow();
    await expect(recordPersonSpecificInstruction(clinician, otherOrganizationId, employeeId, { serviceRecipientRef: "other", procedureReference: "other", credentialId, instructedAt: new Date(), effectiveFrom: new Date(), typedName: "Clinical Reviewer", statement: "This cross-tenant action must not succeed." })).rejects.toThrow();
    await expect(recordMedicationAuthorization(clinician, otherOrganizationId, employeeId, { authorizationType: "AUTHORIZATION", sourceReference: "other", effectiveFrom: new Date(), typedName: "Clinical Reviewer", statement: "This cross-tenant action must not succeed." })).rejects.toThrow();
    await expect(evaluateMedicationDutyEligibility(clinician, otherOrganizationId, employeeId, pathwayId)).rejects.toThrow();
  });
});
