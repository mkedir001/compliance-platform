import { createHash } from "node:crypto";
import { Prisma, type ProfessionalCredentialType, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { createCompetencyAssessment, finalizeCompetencyAssessment } from "@/domain/evidence/service";
import { createManualAssignment } from "@/domain/training/assignments/service";

const attestationInput = z.object({ typedName: z.string().trim().min(2).max(200), statement: z.string().trim().min(10).max(4000) });
const observedInput = z.object({ pathwayId: z.string().cuid(), trainingAssignmentId: z.string().cuid(), credentialId: z.string().cuid(), notes: z.string().max(2000).optional() });
const observedFinalInput = z.object({ credentialId: z.string().cuid(), typedName: z.string().trim().min(2), statement: z.string().trim().min(10), items: z.array(z.object({ skillChecklistItemId: z.string().cuid(), result: z.enum(["PASS", "FAIL", "NOT_OBSERVED", "NOT_APPLICABLE"]), notes: z.string().max(1000).optional() })).min(1), notes: z.string().max(2000).optional() });
const signoffInput = z.object({ pathwayId: z.string().cuid(), trainingCompletionId: z.string().cuid(), competencyAssessmentId: z.string().cuid(), credentialId: z.string().cuid(), typedName: z.string().trim().min(2), statement: z.string().trim().min(10), decision: z.enum(["APPROVED", "DENIED"]) });
const instructionInput = z.object({ serviceRecipientRef: z.string().trim().min(1).max(255), procedureReference: z.string().trim().min(1).max(500), procedureVersion: z.string().max(100).optional(), credentialId: z.string().cuid(), instructedAt: z.coerce.date(), effectiveFrom: z.coerce.date(), effectiveUntil: z.coerce.date().optional(), typedName: z.string().trim().min(2), statement: z.string().trim().min(10), evidenceBasis: z.record(z.string(), z.unknown()).optional() });
const authorizationInput = z.object({ serviceRecipientRef: z.string().trim().min(1).max(255).optional(), authorizationType: z.enum(["AUTHORIZATION", "DELEGATION", "ORGANIZATION_ASSIGNMENT", "CLINICAL_DIRECTION"]), sourceReference: z.string().trim().min(1).max(500), credentialId: z.string().cuid().optional(), effectiveFrom: z.coerce.date(), effectiveUntil: z.coerce.date().optional(), typedName: z.string().trim().min(2), statement: z.string().trim().min(10), evidenceBasis: z.record(z.string(), z.unknown()).optional() });

function signatureHash(input: { organizationId: string; signerUserId: string; resourceType: string; resourceId: string; statement: string; signedAt: Date }) { return createHash("sha256").update(JSON.stringify({ ...input, signedAt: input.signedAt.toISOString() })).digest("hex"); }

async function clinicalAuthority(user: Pick<User, "id">, organizationId: string, permission: "clinical.review" | "medication.approve", credentialId: string, allowedTypes?: ProfessionalCredentialType[], at = new Date()) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, permission);
  const credential = await prisma.professionalCredential.findFirst({ where: { id: credentialId, organizationId, userId: user.id, status: "ACTIVE", verificationStatus: "VERIFIED", OR: [{ expiresAt: null }, { expiresAt: { gte: at } }] } });
  if (!credential || (allowedTypes?.length && !allowedTypes.includes(credential.credentialType))) throw new AuthorizationError("A current verified clinical credential explicitly linked to the acting user is required");
  return credential;
}

async function createClinicalAttestation(tx: Prisma.TransactionClient, input: { organizationId: string; userId: string; typedName: string; statement: string; resourceType: string; resourceId: string; resourceVersionId?: string }) {
  const signedAt = new Date();
  return tx.attestation.create({ data: { organizationId: input.organizationId, attestationType: "TRAINER_ATTESTATION", signerUserId: input.userId, typedName: input.typedName, statementVersion: "phase9-v1", statementSnapshot: input.statement, resourceType: input.resourceType, resourceId: input.resourceId, resourceVersionId: input.resourceVersionId, signedAt, signatureHash: signatureHash({ organizationId: input.organizationId, signerUserId: input.userId, resourceType: input.resourceType, resourceId: input.resourceId, statement: input.statement, signedAt }) } });
}

export async function approveClinicalCurriculum(user: Pick<User, "id">, organizationId: string, courseVersionId: string, raw: unknown) {
  const input = attestationInput.extend({ credentialId: z.string().cuid() }).parse(raw);
  const version = await prisma.trainingCourseVersion.findFirst({ where: { id: courseVersionId, clinicalGovernanceRequired: true, course: { OR: [{ organizationId }, { organizationId: null }] } } });
  if (!version) throw new ResourceNotFoundError("Clinically governed course version not found");
  const credential = await clinicalAuthority(user, organizationId, "clinical.review", input.credentialId, ["RN", "CNS", "CNP", "PA", "PHYSICIAN"]);
  const existing = await prisma.clinicalCurriculumApproval.findFirst({ where: { organizationId, courseVersionId, status: "APPROVED", contentHashSnapshot: version.contentHash } });
  if (existing) return existing;
  return prisma.$transaction(async tx => {
    const attestation = await createClinicalAttestation(tx, { organizationId, userId: user.id, typedName: input.typedName, statement: input.statement, resourceType: "CLINICAL_CURRICULUM_APPROVAL", resourceId: courseVersionId, resourceVersionId: courseVersionId });
    const approval = await tx.clinicalCurriculumApproval.create({ data: { organizationId, courseVersionId, reviewerUserId: user.id, reviewerCredentialId: credential.id, attestationId: attestation.id, approvedAt: attestation.signedAt, contentHashSnapshot: version.contentHash } });
    await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "clinical_curriculum.approved", entityType: "TrainingCourseVersion", entityId: courseVersionId, metadata: { approvalId: approval.id, contentHash: version.contentHash } } });
    return approval;
  });
}

export async function revokeClinicalCurriculumApproval(user: Pick<User, "id">, organizationId: string, approvalId: string, reason: string) {
  const approval = await prisma.clinicalCurriculumApproval.findFirst({ where: { id: approvalId, organizationId }, include: { reviewerCredential: true } });
  if (!approval) throw new ResourceNotFoundError("Clinical curriculum approval not found");
  await clinicalAuthority(user, organizationId, "clinical.review", approval.reviewerCredentialId);
  return prisma.$transaction(async tx => { const revoked = await tx.clinicalCurriculumApproval.update({ where: { id: approval.id }, data: { status: "REVOKED", revokedAt: new Date(), revocationReason: reason } }); await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "clinical_curriculum.revoked", entityType: "ClinicalCurriculumApproval", entityId: approval.id, metadata: { reason } } }); return revoked; });
}

export async function createMedicationObservedAssessment(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const input = observedInput.parse(raw); await requireEmployeeAccess(user, organizationId, employeeId, "competency.assess");
  const pathway = await prisma.medicationQualificationPathway.findFirst({ where: { id: input.pathwayId, organizationId }, include: { skillChecklistVersion: { include: { items: true } } } });
  if (!pathway || pathway.skillChecklistVersion.status !== "ACTIVE" || !pathway.skillChecklistVersion.items.length) throw new ResourceNotFoundError("Active medication checklist pathway not found");
  await clinicalAuthority(user, organizationId, "clinical.review", input.credentialId, pathway.allowedReviewerCredentialTypes);
  const completion = await prisma.trainingCompletion.findFirst({ where: { organizationId, employeeId, assignmentId: input.trainingAssignmentId, courseVersionId: pathway.courseVersionId } });
  if (!completion) throw new AuthorizationError("Governed medication training and knowledge requirements must be completed first");
  return createCompetencyAssessment(user.id, organizationId, { employeeId, competencyDefinitionId: pathway.competencyDefinitionId, skillChecklistVersionId: pathway.skillChecklistVersionId, trainingAssignmentId: input.trainingAssignmentId, notes: input.notes });
}

export async function finalizeMedicationObservedAssessment(user: Pick<User, "id">, organizationId: string, assessmentId: string, raw: unknown) {
  const input = observedFinalInput.parse(raw);
  const assessment = await prisma.competencyAssessment.findFirst({ where: { id: assessmentId, organizationId }, include: { skillChecklistVersion: { include: { medicationPathways: true } } } });
  const pathway = assessment?.skillChecklistVersion?.medicationPathways.find(item => item.organizationId === organizationId && item.competencyDefinitionId === assessment.competencyDefinitionId);
  if (!assessment || !pathway) throw new ResourceNotFoundError("Medication observed assessment not found");
  await clinicalAuthority(user, organizationId, "clinical.review", input.credentialId, pathway.allowedReviewerCredentialTypes);
  const finalized = await finalizeCompetencyAssessment(user.id, organizationId, assessment.id, { items: input.items, notes: input.notes });
  await prisma.$transaction(async tx => { const attestation = await createClinicalAttestation(tx, { organizationId, userId: user.id, typedName: input.typedName, statement: input.statement, resourceType: "MEDICATION_OBSERVED_ASSESSMENT", resourceId: assessment.id, resourceVersionId: assessment.skillChecklistVersionId ?? undefined }); await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_skill_assessment.finalized", entityType: "CompetencyAssessment", entityId: assessment.id, metadata: { result: finalized.result, attestationId: attestation.id, checklistVersionId: assessment.skillChecklistVersionId } } }); });
  return finalized;
}

export async function signoffMedicationQualification(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const input = signoffInput.parse(raw);
  const pathway = await prisma.medicationQualificationPathway.findFirst({ where: { id: input.pathwayId, organizationId }, include: { courseVersion: true } });
  if (!pathway) throw new ResourceNotFoundError("Medication qualification pathway not found");
  const credential = await clinicalAuthority(user, organizationId, "medication.approve", input.credentialId, pathway.allowedReviewerCredentialTypes);
  const [completion, assessment, approval] = await Promise.all([
    prisma.trainingCompletion.findFirst({ where: { id: input.trainingCompletionId, organizationId, employeeId, courseVersionId: pathway.courseVersionId }, include: { finalAssessmentAttempt: true } }),
    prisma.competencyAssessment.findFirst({ where: { id: input.competencyAssessmentId, organizationId, employeeId, competencyDefinitionId: pathway.competencyDefinitionId, skillChecklistVersionId: pathway.skillChecklistVersionId, status: "FINALIZED", result: "PASS" } }),
    prisma.clinicalCurriculumApproval.findFirst({ where: { organizationId, courseVersionId: pathway.courseVersionId, status: "APPROVED", contentHashSnapshot: pathway.courseVersion.contentHash } }),
  ]);
  if (!completion || (pathway.requiresKnowledgeAssessment && !completion.finalAssessmentAttempt?.passed) || (pathway.requiresObservedSkill && !assessment) || !approval) throw new AuthorizationError("Governed training, knowledge, observed skill, and clinical curriculum approval are required");
  const existing = assessment ? await prisma.medicationQualification.findUnique({ where: { trainingCompletionId_competencyAssessmentId: { trainingCompletionId: completion.id, competencyAssessmentId: assessment.id } } }) : null;
  if (existing) return existing;
  if (!assessment) throw new AuthorizationError("Observed skill assessment is required");
  return prisma.$transaction(async tx => {
    const key = `${completion.id}:${assessment.id}`;
    const attestation = await createClinicalAttestation(tx, { organizationId, userId: user.id, typedName: input.typedName, statement: input.statement, resourceType: "MEDICATION_QUALIFICATION", resourceId: key, resourceVersionId: pathway.id });
    const qualifiedAt = attestation.signedAt, validUntil = pathway.validityDays ? new Date(qualifiedAt.getTime() + pathway.validityDays * 86_400_000) : null;
    const qualification = await tx.medicationQualification.create({ data: { organizationId, employeeId, courseVersionId: pathway.courseVersionId, trainingCompletionId: completion.id, competencyAssessmentId: assessment.id, skillChecklistVersionId: pathway.skillChecklistVersionId, reviewerUserId: user.id, reviewerCredentialId: credential.id, attestationId: attestation.id, decision: input.decision, status: "ACTIVE", qualifiedAt, validUntil, evidenceSnapshotJson: { pathwayId: pathway.id, clinicalCurriculumApprovalId: approval.id, courseVersionId: pathway.courseVersionId, courseContentHash: pathway.courseVersion.contentHash, trainingCompletionId: completion.id, assessmentAttemptId: completion.finalAssessmentAttemptId, competencyAssessmentId: assessment.id, skillChecklistVersionId: pathway.skillChecklistVersionId, checklistContentHash: (await tx.skillChecklistVersion.findUniqueOrThrow({ where: { id: pathway.skillChecklistVersionId } })).contentHash, reviewerCredentialId: credential.id } } });
    await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_qualification.signed_off", entityType: "MedicationQualification", entityId: qualification.id, metadata: { decision: input.decision } } });
    return qualification;
  });
}

export async function recordPersonSpecificInstruction(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const input = instructionInput.parse(raw); await requireEmployeeAccess(user, organizationId, employeeId, "medication.approve");
  const credential = await clinicalAuthority(user, organizationId, "clinical.review", input.credentialId);
  const existing = await prisma.personSpecificMedicationInstruction.findFirst({ where: { organizationId, employeeId, serviceRecipientRef: input.serviceRecipientRef, procedureReference: input.procedureReference, procedureVersion: input.procedureVersion, status: "ACTIVE" } }); if (existing) return existing;
  return prisma.$transaction(async tx => { const key = `${employeeId}:${input.serviceRecipientRef}:${input.procedureReference}:${input.procedureVersion ?? "current"}`; const attestation = await createClinicalAttestation(tx, { organizationId, userId: user.id, typedName: input.typedName, statement: input.statement, resourceType: "PERSON_SPECIFIC_MEDICATION_INSTRUCTION", resourceId: key, resourceVersionId: input.procedureVersion }); const instruction = await tx.personSpecificMedicationInstruction.create({ data: { organizationId, employeeId, serviceRecipientRef: input.serviceRecipientRef, procedureReference: input.procedureReference, procedureVersion: input.procedureVersion, reviewerUserId: user.id, reviewerCredentialId: credential.id, attestationId: attestation.id, instructedAt: input.instructedAt, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil, evidenceBasis: input.evidenceBasis as Prisma.InputJsonValue } }); await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_instruction.recorded", entityType: "PersonSpecificMedicationInstruction", entityId: instruction.id } }); return instruction; });
}

export async function recordMedicationAuthorization(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const input = authorizationInput.parse(raw); await requireEmployeeAccess(user, organizationId, employeeId, "medication.approve");
  if (["DELEGATION", "CLINICAL_DIRECTION"].includes(input.authorizationType) && !input.credentialId) throw new AuthorizationError("Clinical delegation or direction requires a current verified clinical credential");
  if (input.credentialId) await clinicalAuthority(user, organizationId, "medication.approve", input.credentialId);
  const existing = await prisma.medicationAuthorizationEvidence.findFirst({ where: { organizationId, employeeId, serviceRecipientRef: input.serviceRecipientRef, authorizationType: input.authorizationType, sourceReference: input.sourceReference, status: "ACTIVE" } }); if (existing) return existing;
  return prisma.$transaction(async tx => { const key = `${employeeId}:${input.serviceRecipientRef ?? "general"}:${input.authorizationType}:${input.sourceReference}`; const attestation = await createClinicalAttestation(tx, { organizationId, userId: user.id, typedName: input.typedName, statement: input.statement, resourceType: "MEDICATION_AUTHORIZATION_EVIDENCE", resourceId: key }); const evidence = await tx.medicationAuthorizationEvidence.create({ data: { organizationId, employeeId, serviceRecipientRef: input.serviceRecipientRef, authorizationType: input.authorizationType, sourceReference: input.sourceReference, recordedByUserId: user.id, reviewerCredentialId: input.credentialId, attestationId: attestation.id, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil, evidenceBasis: input.evidenceBasis as Prisma.InputJsonValue } }); await tx.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_authorization.recorded", entityType: "MedicationAuthorizationEvidence", entityId: evidence.id } }); return evidence; });
}

export type MedicationQualificationState = "NOT_STARTED" | "TRAINING_IN_PROGRESS" | "KNOWLEDGE_ASSESSMENT_REQUIRED" | "KNOWLEDGE_COMPLETE" | "SKILL_ASSESSMENT_REQUIRED" | "SKILL_ASSESSMENT_FAILED" | "CLINICAL_SIGNOFF_REQUIRED" | "QUALIFIED" | "EXPIRED" | "SUSPENDED";
export async function computeMedicationQualification(organizationId: string, employeeId: string, pathwayId: string, at = new Date()) {
  const pathway = await prisma.medicationQualificationPathway.findFirst({ where: { id: pathwayId, organizationId }, include: { courseVersion: true } }); if (!pathway) throw new ResourceNotFoundError("Medication qualification pathway not found");
  const assignments = await prisma.trainingAssignment.findMany({ where: { organizationId, employeeId, courseVersionId: pathway.courseVersionId, status: { notIn: ["CANCELLED", "SUPERSEDED"] } }, include: { completion: { include: { finalAssessmentAttempt: true } } }, orderBy: { assignedAt: "desc" } });
  const assignment = assignments[0], completion = assignment?.completion;
  const approval = await prisma.clinicalCurriculumApproval.findFirst({ where: { organizationId, courseVersionId: pathway.courseVersionId, status: "APPROVED", contentHashSnapshot: pathway.courseVersion.contentHash } });
  const assessment = await prisma.competencyAssessment.findFirst({ where: { organizationId, employeeId, competencyDefinitionId: pathway.competencyDefinitionId, skillChecklistVersionId: pathway.skillChecklistVersionId, status: "FINALIZED" }, orderBy: { finalizedAt: "desc" } });
  const qualification = completion && assessment ? await prisma.medicationQualification.findUnique({ where: { trainingCompletionId_competencyAssessmentId: { trainingCompletionId: completion.id, competencyAssessmentId: assessment.id } } }) : null;
  let state: MedicationQualificationState = "NOT_STARTED";
  const reasons: string[] = [];
  if (!assignment) reasons.push("MEDICATION_TRAINING_REQUIRED");
  else if (!completion) { state = "TRAINING_IN_PROGRESS"; reasons.push("MEDICATION_TRAINING_INCOMPLETE"); }
  else if (pathway.requiresKnowledgeAssessment && !completion.finalAssessmentAttempt?.passed) { state = "KNOWLEDGE_ASSESSMENT_REQUIRED"; reasons.push("KNOWLEDGE_ASSESSMENT_REQUIRED"); }
  else if (!approval) { state = "CLINICAL_SIGNOFF_REQUIRED"; reasons.push("CLINICAL_CURRICULUM_APPROVAL_REQUIRED"); }
  else if (pathway.requiresObservedSkill && !assessment) { state = "SKILL_ASSESSMENT_REQUIRED"; reasons.push("OBSERVED_SKILL_ASSESSMENT_REQUIRED"); }
  else if (assessment && assessment.result !== "PASS") { state = "SKILL_ASSESSMENT_FAILED"; reasons.push("OBSERVED_SKILL_ASSESSMENT_FAILED"); }
  else if (!qualification || qualification.decision !== "APPROVED") { state = "CLINICAL_SIGNOFF_REQUIRED"; reasons.push("CLINICAL_SIGNOFF_REQUIRED"); }
  else if (qualification.status !== "ACTIVE") { state = "SUSPENDED"; reasons.push("QUALIFICATION_REVOKED"); }
  else if (qualification.validUntil && qualification.validUntil < at) { state = "EXPIRED"; reasons.push("QUALIFICATION_EXPIRED"); }
  else state = "QUALIFIED";
  const remediationByReason: Record<string, string> = { MEDICATION_TRAINING_REQUIRED: "ASSIGN_MEDICATION_TRAINING", MEDICATION_TRAINING_INCOMPLETE: "RESUME_MEDICATION_TRAINING", KNOWLEDGE_ASSESSMENT_REQUIRED: "RETAKE_MEDICATION_KNOWLEDGE_ASSESSMENT", CLINICAL_CURRICULUM_APPROVAL_REQUIRED: "CLINICAL_REVIEW_REQUIRED", OBSERVED_SKILL_ASSESSMENT_REQUIRED: "SCHEDULE_MEDICATION_SKILL_ASSESSMENT", OBSERVED_SKILL_ASSESSMENT_FAILED: "REMEDIATE_MEDICATION_SKILL", CLINICAL_SIGNOFF_REQUIRED: "CLINICAL_REVIEW_REQUIRED", QUALIFICATION_REVOKED: "CLINICAL_REVIEW_REQUIRED", QUALIFICATION_EXPIRED: "REQUALIFICATION_REQUIRED" };
  return { organizationId, employeeId, pathway, assignment, completion, clinicalApproval: approval, observedAssessment: assessment, qualification, state, reasons, remediations: reasons.map(reason => ({ type: remediationByReason[reason], reason })).filter(item => item.type), evaluatedAt: at.toISOString() };
}

export async function getMedicationQualification(user: Pick<User, "id">, organizationId: string, employeeId: string, pathwayId: string, at = new Date()) { await requireEmployeeAccess(user, organizationId, employeeId, "compliance.operations.read"); return computeMedicationQualification(organizationId, employeeId, pathwayId, at); }

export async function listMedicationQualifications(user: Pick<User, "id">, organizationId: string, employeeId: string, at = new Date()) {
  await requireEmployeeAccess(user, organizationId, employeeId, "compliance.operations.read");
  const pathways = await prisma.medicationQualificationPathway.findMany({ where: { organizationId }, select: { id: true } });
  return Promise.all(pathways.map(pathway => computeMedicationQualification(organizationId, employeeId, pathway.id, at)));
}

export async function getMedicationEvidence(user: Pick<User, "id">, organizationId: string, employeeId: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "compliance.operations.read");
  const [qualifications, instructions, authorizations] = await Promise.all([
    prisma.medicationQualification.findMany({ where: { organizationId, employeeId }, include: { trainingCompletion: true, competencyAssessment: true, reviewerCredential: true, attestation: true }, orderBy: { qualifiedAt: "desc" } }),
    prisma.personSpecificMedicationInstruction.findMany({ where: { organizationId, employeeId }, include: { reviewerCredential: true, attestation: true }, orderBy: { instructedAt: "desc" } }),
    prisma.medicationAuthorizationEvidence.findMany({ where: { organizationId, employeeId }, include: { reviewerCredential: true, attestation: true }, orderBy: { effectiveFrom: "desc" } }),
  ]);
  return { qualifications, instructions, authorizations };
}

export async function assignMedicationTraining(user: Pick<User, "id">, organizationId: string, employeeId: string, pathwayId: string) {
  const pathway = await prisma.medicationQualificationPathway.findFirst({ where: { id: pathwayId, organizationId } });
  if (!pathway) throw new ResourceNotFoundError("Medication qualification pathway not found");
  const assignment = await createManualAssignment(user, organizationId, { employeeId, courseVersionId: pathway.courseVersionId });
  await prisma.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_remediation.training_assigned", entityType: "TrainingAssignment", entityId: assignment.id, metadata: { pathwayId, courseVersionId: pathway.courseVersionId } } });
  return assignment;
}

export async function evaluateMedicationDutyEligibility(user: Pick<User, "id">, organizationId: string, employeeId: string, pathwayId: string, serviceRecipientRef?: string, at = new Date()) {
  await requireEmployeeAccess(user, organizationId, employeeId, "compliance.operations.read");
  const result = await computeMedicationQualification(organizationId, employeeId, pathwayId, at), reasons = [...result.reasons];
  const [instruction, authorizations, medicationDuty] = await Promise.all([
    serviceRecipientRef ? prisma.personSpecificMedicationInstruction.findFirst({ where: { organizationId, employeeId, serviceRecipientRef, status: "ACTIVE", effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }] } }) : null,
    prisma.medicationAuthorizationEvidence.findMany({ where: { organizationId, employeeId, status: "ACTIVE", effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }], AND: serviceRecipientRef ? [{ OR: [{ serviceRecipientRef: null }, { serviceRecipientRef }] }] : [{ serviceRecipientRef: null }] } }),
    prisma.employeeDuty.findFirst({ where: { employeeId, dutyDefinition: { code: "MEDICATION_ADMINISTRATION" }, effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }] } }),
  ]);
  if (result.pathway.requiresPersonInstruction && !instruction) reasons.push("PERSON_SPECIFIC_INSTRUCTION_REQUIRED");
  if (result.pathway.requiresAuthorization && !authorizations.some(item => item.authorizationType === "AUTHORIZATION" || item.authorizationType === "CLINICAL_DIRECTION")) reasons.push("AUTHORIZATION_REQUIRED");
  if (result.pathway.requiresDelegation && !authorizations.some(item => item.authorizationType === "DELEGATION")) reasons.push("DELEGATION_REQUIRED");
  if (result.pathway.requiresMedicationDuty && !medicationDuty) reasons.push("MEDICATION_DUTY_ASSIGNMENT_REQUIRED");
  const remediationByReason: Record<string, string> = { PERSON_SPECIFIC_INSTRUCTION_REQUIRED: "RECORD_PERSON_SPECIFIC_INSTRUCTION", AUTHORIZATION_REQUIRED: "RECORD_AUTHORIZATION_EVIDENCE", DELEGATION_REQUIRED: "RECORD_DELEGATION_EVIDENCE", MEDICATION_DUTY_ASSIGNMENT_REQUIRED: "ASSIGN_MEDICATION_DUTY" };
  const decision = { eligible: result.state === "QUALIFIED" && reasons.length === 0, evaluatedAt: at.toISOString(), worker: employeeId, serviceRecipientRef: serviceRecipientRef ?? null, trainingQualificationState: result.state, applicableRequirements: [result.pathway.requirementVersionId], satisfiedRequirements: result.state === "QUALIFIED" ? [result.pathway.requirementVersionId] : [], blockingRequirements: result.state === "QUALIFIED" ? [] : [result.pathway.requirementVersionId], missingPersonSpecificInstruction: result.pathway.requiresPersonInstruction && !instruction, missingAuthorization: result.pathway.requiresAuthorization && !authorizations.some(item => item.authorizationType === "AUTHORIZATION" || item.authorizationType === "CLINICAL_DIRECTION"), reasonCodes: [...new Set(reasons)], remediations: [...result.remediations, ...reasons.map(reason => ({ type: remediationByReason[reason], reason })).filter(item => item.type)], evidenceBasis: { qualificationId: result.qualification?.id ?? null, instructionId: instruction?.id ?? null, authorizationIds: authorizations.map(item => item.id), medicationDutyId: medicationDuty?.id ?? null }, disclaimer: "Platform-derived medication readiness based on configured requirements and recorded evidence; not a legal opinion." };
  await prisma.clinicalGovernanceEvent.create({ data: { organizationId, actorUserId: user.id, action: "medication_eligibility.evaluated", entityType: "Employee", entityId: employeeId, metadata: decision as unknown as Prisma.InputJsonValue } });
  return decision;
}
