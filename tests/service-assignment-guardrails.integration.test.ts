import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createServiceAssignment, evaluateProposedAssignment, getServiceAssignment, reevaluateServiceAssignment } from "@/domain/service-assignments/service";

const db = new PrismaClient();

describe.sequential("Phase 10 service assignment eligibility guardrails", () => {
  let organizationId: string, otherOrganizationId: string, ownerId: string, workerId: string, inactiveId: string, programId: string, otherProgramId: string;
  let medicationPathwayId: string, medicationDutyId: string, recipientA: string;

  beforeAll(async () => {
    const tag = `phase10-${Date.now()}`, organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }), other = await db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } }), owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } });
    organizationId = organization.id; otherOrganizationId = other.id; ownerId = owner.id; recipientA = `${tag}-recipient-a`;
    const membership = await db.organizationMembership.create({ data: { organizationId, userId: owner.id, status: "ACTIVE" } }), ownerRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: ownerRole.id } });
    const [worker, inactive, program, otherProgram] = await Promise.all([
      db.employee.create({ data: { organizationId, firstName: "Eligible", lastName: tag, employmentStatus: "ACTIVE" } }),
      db.employee.create({ data: { organizationId, firstName: "Inactive", lastName: tag, employmentStatus: "LEAVE" } }),
      db.program.create({ data: { organizationId, name: `${tag} training required`, code: `${tag}-training` } }),
      db.program.create({ data: { organizationId, name: `${tag} competency required`, code: `${tag}-competency` } }),
    ]);
    workerId = worker.id; inactiveId = inactive.id; programId = program.id; otherProgramId = otherProgram.id;
    const ruleset = await db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const trainingRequirement = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-002" } } });
    const competencyRequirement = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-017" } } });
    const requiredCompetency = await db.competencyDefinition.create({ data: { organizationId, code: `${tag}-required`, name: "Synthetic required competency", method: "OBSERVED_SKILL", ownerType: "ORGANIZATION" } });
    await db.competencyRequirement.create({ data: { requirementVersionId: competencyRequirement.id, competencyDefinitionId: requiredCompetency.id, required: true } });
    await db.serviceAssignmentRequirementRule.createMany({ data: [
      { organizationId, name: "Test required training", programId, requirementVersionId: trainingRequirement.id },
      { organizationId, name: "Test required competency", programId: otherProgramId, requirementVersionId: competencyRequirement.id },
    ] });
    await db.complianceInstance.createMany({ data: [
      { fingerprint: `${tag}:training`, organizationId, employeeId: worker.id, requirementVersionId: trainingRequirement.id, triggerType: "EMPLOYEE_HIRED", requiredAt: new Date(), status: "ASSIGNED", lastEvaluatedAt: new Date(), rulesetId: ruleset.id },
      { fingerprint: `${tag}:competency`, organizationId, employeeId: worker.id, requirementVersionId: competencyRequirement.id, triggerType: "EMPLOYEE_HIRED", requiredAt: new Date(), status: "ASSIGNED", lastEvaluatedAt: new Date(), rulesetId: ruleset.id },
    ] });

    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${tag}:med`, code: `${tag}-med`, title: "Synthetic medication guardrail fixture", category: "MEDICATION", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date(), contentHash: `${tag}-course-v1`, clinicalGovernanceRequired: true, modules: { create: { sequence: 1, title: "Synthetic", moduleType: "ASSESSMENT", assessments: { create: { versionNumber: 1, title: "Synthetic knowledge", passingScore: 80, status: "PUBLISHED" } } } } } } }, include: { versions: { include: { modules: { include: { assessments: true } } } } } });
    const courseVersion = course.versions[0], assessment = courseVersion.modules[0].assessments[0];
    const checklist = await db.skillChecklist.create({ data: { organizationId, code: `${tag}-check`, name: "Synthetic checklist", ownerType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "ACTIVE", contentHash: `${tag}-check-v1`, items: { create: { sequence: 1, description: "Synthetic observed item" } } } } }, include: { versions: { include: { items: true } } } });
    const definition = await db.competencyDefinition.create({ data: { organizationId, code: `${tag}-skill`, name: "Synthetic observed skill", method: "OBSERVED_SKILL", ownerType: "ORGANIZATION" } });
    const pathwayRequirement = await db.complianceRequirementVersion.findFirstOrThrow({ where: { status: "ACTIVE", requirement: { code: "245D-WF-014" } } });
    const pathway = await db.medicationQualificationPathway.create({ data: { organizationId, requirementVersionId: pathwayRequirement.id, courseVersionId: courseVersion.id, competencyDefinitionId: definition.id, skillChecklistVersionId: checklist.versions[0].id, allowedReviewerCredentialTypes: ["RN"] } }); medicationPathwayId = pathway.id;
    const trainingAssignment = await db.trainingAssignment.create({ data: { fingerprint: `${tag}:med-training`, organizationId, employeeId: worker.id, courseVersionId: courseVersion.id, sourceType: "MANUAL", status: "COMPLETED", completedAt: new Date() } });
    const attempt = await db.assessmentAttempt.create({ data: { organizationId, employeeId: worker.id, trainingAssignmentId: trainingAssignment.id, assessmentId: assessment.id, courseVersionId: courseVersion.id, attemptNumber: 1, submittedAt: new Date(), score: 1, maxScore: 1, percentage: 100, passed: true, resultSnapshot: { passed: true } } });
    const completion = await db.trainingCompletion.create({ data: { organizationId, employeeId: worker.id, assignmentId: trainingAssignment.id, courseId: course.id, courseVersionId: courseVersion.id, completedAt: new Date(), completionMethod: "COURSEWORK", finalAssessmentAttemptId: attempt.id, evidenceSnapshotJson: { synthetic: true }, contentHash: courseVersion.contentHash } });
    const competency = await db.competencyAssessment.create({ data: { organizationId, employeeId: worker.id, competencyDefinitionId: definition.id, skillChecklistVersionId: checklist.versions[0].id, trainingAssignmentId: trainingAssignment.id, assessorUserId: owner.id, assessorNameSnapshot: "Synthetic test reviewer", status: "FINALIZED", result: "PASS", completedAt: new Date(), finalizedAt: new Date(), items: { create: { skillChecklistItemId: checklist.versions[0].items[0].id, result: "PASS" } } } });
    const credential = await db.professionalCredential.create({ data: { organizationId, userId: owner.id, credentialType: "RN", verificationStatus: "VERIFIED", verifiedAt: new Date(), status: "ACTIVE", evidenceReference: "synthetic-test-only" } });
    const makeAttestation = async (type: string) => db.attestation.create({ data: { organizationId, attestationType: "TRAINER_ATTESTATION", signerUserId: owner.id, typedName: "Synthetic Reviewer", statementVersion: "test", statementSnapshot: type, resourceType: type, resourceId: `${tag}:${type}`, signedAt: new Date(), signatureHash: createHash("sha256").update(`${tag}:${type}`).digest("hex") } });
    const [approvalAttestation, qualificationAttestation] = await Promise.all([makeAttestation("CURRICULUM"), makeAttestation("QUALIFICATION")]);
    const approval = await db.clinicalCurriculumApproval.create({ data: { organizationId, courseVersionId: courseVersion.id, reviewerUserId: owner.id, reviewerCredentialId: credential.id, attestationId: approvalAttestation.id, approvedAt: new Date(), contentHashSnapshot: courseVersion.contentHash } });
    await db.medicationQualification.create({ data: { organizationId, employeeId: worker.id, courseVersionId: courseVersion.id, trainingCompletionId: completion.id, competencyAssessmentId: competency.id, skillChecklistVersionId: checklist.versions[0].id, reviewerUserId: owner.id, reviewerCredentialId: credential.id, attestationId: qualificationAttestation.id, decision: "APPROVED", qualifiedAt: new Date(), evidenceSnapshotJson: { clinicalCurriculumApprovalId: approval.id, courseVersionId: courseVersion.id, checklistVersionId: checklist.versions[0].id } } });
    medicationDutyId = (await db.dutyDefinition.findUniqueOrThrow({ where: { code: "MEDICATION_ADMINISTRATION" } })).id;
    await db.employeeDuty.create({ data: { employeeId: worker.id, dutyDefinitionId: medicationDutyId, effectiveFrom: new Date("2026-01-01"), source: "synthetic Phase 10 fixture" } });
    const instructionAttestation = await makeAttestation("PERSON_INSTRUCTION");
    await db.personSpecificMedicationInstruction.create({ data: { organizationId, employeeId: worker.id, serviceRecipientRef: recipientA, procedureReference: "synthetic procedure", reviewerUserId: owner.id, reviewerCredentialId: credential.id, attestationId: instructionAttestation.id, instructedAt: new Date(), effectiveFrom: new Date("2026-01-01") } });
  });

  const owner = () => ({ id: ownerId });
  const proposal = (overrides: Record<string, unknown> = {}) => ({ employeeId: workerId, startsAt: new Date(Date.now() + 86_400_000), blockingScope: "GENERAL_WORK", dutyDefinitionIds: [], ...overrides });

  it("creates active assignments only for eligible workers", async () => {
    const result = await createServiceAssignment(owner(), organizationId, proposal());
    expect(result.eligibility.decision).toBe("ELIGIBLE"); expect(result.assignment.status).toBe("ACTIVE");
  });

  it("returns specific training and competency blockers from configured assignment rules", async () => {
    expect((await evaluateProposedAssignment(owner(), organizationId, proposal({ programId }))).reasonCodes).toContain("REQUIRED_TRAINING_MISSING");
    expect((await evaluateProposedAssignment(owner(), organizationId, proposal({ programId: otherProgramId }))).reasonCodes).toContain("REQUIRED_COMPETENCY_MISSING");
  });

  it("blocks inactive workers", async () => {
    const result = await createServiceAssignment(owner(), organizationId, proposal({ employeeId: inactiveId }));
    expect(result.assignment.status).toBe("BLOCKED"); expect(result.eligibility.reasonCodes).toContain("EMPLOYEE_INACTIVE");
  });

  it("does not treat medication course completion alone as medication-duty eligibility", async () => {
    const tag = `course-only-${Date.now()}`, pathway = await db.medicationQualificationPathway.findUniqueOrThrow({ where: { id: medicationPathwayId }, include: { courseVersion: { include: { course: true, modules: { include: { assessments: true } } } } } });
    const employee = await db.employee.create({ data: { organizationId, firstName: "Course", lastName: "Only", employmentStatus: "ACTIVE" } });
    const training = await db.trainingAssignment.create({ data: { fingerprint: tag, organizationId, employeeId: employee.id, courseVersionId: pathway.courseVersionId, sourceType: "MANUAL", status: "COMPLETED", completedAt: new Date() } });
    const assessment = pathway.courseVersion.modules[0].assessments[0], attempt = await db.assessmentAttempt.create({ data: { organizationId, employeeId: employee.id, trainingAssignmentId: training.id, assessmentId: assessment.id, courseVersionId: pathway.courseVersionId, attemptNumber: 1, submittedAt: new Date(), score: 1, maxScore: 1, percentage: 100, passed: true, resultSnapshot: { passed: true } } });
    await db.trainingCompletion.create({ data: { organizationId, employeeId: employee.id, assignmentId: training.id, courseId: pathway.courseVersion.courseId, courseVersionId: pathway.courseVersionId, completedAt: new Date(), completionMethod: "COURSEWORK", finalAssessmentAttemptId: attempt.id, evidenceSnapshotJson: { synthetic: true }, contentHash: pathway.courseVersion.contentHash } });
    await db.employeeDuty.create({ data: { employeeId: employee.id, dutyDefinitionId: medicationDutyId, effectiveFrom: new Date("2026-01-01") } });
    const result = await evaluateProposedAssignment(owner(), organizationId, proposal({ employeeId: employee.id, blockingScope: "MEDICATION_ADMINISTRATION", medicationPathwayId, dutyDefinitionIds: [medicationDutyId], serviceRecipientRef: recipientA }));
    expect(result.eligible).toBe(false); expect(result.reasonCodes).toContain("OBSERVED_SKILL_ASSESSMENT_REQUIRED");
  });

  it("honors Phase 9 person-specific and authorization boundaries", async () => {
    const context = { blockingScope: "MEDICATION_ADMINISTRATION", medicationPathwayId, dutyDefinitionIds: [medicationDutyId] };
    const otherPerson = await evaluateProposedAssignment(owner(), organizationId, proposal({ ...context, serviceRecipientRef: "different-recipient" }));
    expect(otherPerson.reasonCodes).toContain("PERSON_SPECIFIC_INSTRUCTION_REQUIRED");
    const missingAuthorization = await evaluateProposedAssignment(owner(), organizationId, proposal({ ...context, serviceRecipientRef: recipientA }));
    expect(missingAuthorization.reasonCodes).not.toContain("PERSON_SPECIFIC_INSTRUCTION_REQUIRED"); expect(missingAuthorization.reasonCodes).toContain("AUTHORIZATION_REQUIRED");
    const override = await createServiceAssignment(owner(), organizationId, proposal({ ...context, serviceRecipientRef: recipientA, overrideReason: "Operational request cannot override clinical evidence." }));
    expect(override.assignment.status).toBe("BLOCKED"); expect(override.eligibility.reasonCodes).toContain("OVERRIDE_REJECTED_NON_OVERRIDABLE_COMPLIANCE_GUARDRAIL");
  });

  it("permits medication assignment only after separate authorization evidence", async () => {
    const attestation = await db.attestation.create({ data: { organizationId, attestationType: "TRAINER_ATTESTATION", signerUserId: ownerId, typedName: "Synthetic Reviewer", statementVersion: "test", statementSnapshot: "authorization", resourceType: "AUTHORIZATION", resourceId: `${recipientA}:authorization`, signedAt: new Date(), signatureHash: createHash("sha256").update(`${recipientA}:authorization`).digest("hex") } });
    await db.medicationAuthorizationEvidence.create({ data: { organizationId, employeeId: workerId, serviceRecipientRef: recipientA, authorizationType: "AUTHORIZATION", sourceReference: "synthetic written authorization", recordedByUserId: ownerId, attestationId: attestation.id, effectiveFrom: new Date("2026-01-01") } });
    const result = await createServiceAssignment(owner(), organizationId, proposal({ blockingScope: "MEDICATION_ADMINISTRATION", medicationPathwayId, dutyDefinitionIds: [medicationDutyId], serviceRecipientRef: recipientA }));
    expect(result.eligibility.reasonCodes).toEqual([]); expect(result.assignment.status).toBe("ACTIVE");
  });

  it("appends re-evaluations without rewriting the assignment-time decision", async () => {
    const created = await createServiceAssignment(owner(), organizationId, proposal());
    const initial = await db.serviceAssignmentEligibilityEvaluation.findUniqueOrThrow({ where: { id: created.evaluationId } });
    await db.employee.update({ where: { id: workerId }, data: { employmentStatus: "LEAVE" } });
    const current = await reevaluateServiceAssignment(owner(), organizationId, created.assignment.id);
    expect(current.changed).toBe(true); expect(current.reasonCodes).toContain("EMPLOYEE_INACTIVE");
    expect((await db.serviceAssignment.findUniqueOrThrow({ where: { id: created.assignment.id } })).status).toBe("BLOCKED");
    expect((await db.serviceAssignmentEligibilityEvaluation.findUniqueOrThrow({ where: { id: initial.id } })).resultSnapshot).toEqual(initial.resultSnapshot);
    expect(await db.serviceAssignmentEligibilityEvaluation.count({ where: { assignmentId: created.assignment.id } })).toBe(2);
    await db.employee.update({ where: { id: workerId }, data: { employmentStatus: "ACTIVE" } });
  });

  it("enforces tenant isolation and assignment RBAC", async () => {
    const created = await createServiceAssignment(owner(), organizationId, proposal());
    await expect(getServiceAssignment(owner(), otherOrganizationId, created.assignment.id)).rejects.toThrow();
    await expect(evaluateProposedAssignment(owner(), otherOrganizationId, proposal())).rejects.toThrow();
    const viewer = await db.user.findUniqueOrThrow({ where: { email: "jordan.viewer@example.test" } });
    await expect(createServiceAssignment({ id: viewer.id }, organizationId, proposal())).rejects.toThrow();
  });
});
