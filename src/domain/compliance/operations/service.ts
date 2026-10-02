import type { BlockingScope, ComplianceEvidenceType, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { evaluateEmployeeCompliance } from "@/domain/compliance/evaluation/service";
import { assignTrainingForCompliance } from "@/domain/training/assignments/service";
import { computeEmployeeWorkReadiness, evaluateEmployeeWorkReadiness, scopeAffected } from "@/domain/readiness/service";
import { deriveTemporalStatus, getExpiringSoonDays } from "./deadlines";

export const COMPLIANCE_OPERATIONS_ENGINE_VERSION = "phase8-v1";
export type OperationalStatus = "READY" | "NOT_READY" | "REQUIREMENTS_PENDING" | "ACTION_REQUIRED" | "EXPIRING_SOON" | "OVERDUE" | "BLOCKED";
export type RemediationType = "ASSIGN_REQUIRED_TRAINING" | "RESUME_INCOMPLETE_TRAINING" | "RETAKE_FAILED_ASSESSMENT" | "COMPLETE_COMPETENCY_ASSESSMENT" | "OBTAIN_ASSESSOR_SIGN_OFF" | "RENEW_EXPIRED_CREDENTIAL" | "UPLOAD_VERIFY_EXTERNAL_EVIDENCE" | "ACKNOWLEDGE_REQUIRED_POLICY" | "COMPLETE_ONBOARDING_STEP" | "OBTAIN_REQUIRED_ATTESTATION" | "OBTAIN_MEDICATION_COMPETENCY_EVIDENCE";
export type RemediationAction = { type: RemediationType; resourceType: string; resourceId: string; requirementVersionId?: string; executable: boolean; message: string };

type EvidenceBasis = { type: ComplianceEvidenceType; referenceId: string; evidenceDate: string | null; expiresAt: string | null; temporalStatus: ReturnType<typeof deriveTemporalStatus>; corrected: boolean };

async function resolveEvidence(organizationId: string, links: { evidenceType: ComplianceEvidenceType; evidenceReferenceId: string }[], evaluatedAt: Date, timeZone: string): Promise<EvidenceBasis[]> {
  const ids = links.map(link => link.evidenceReferenceId);
  const [completions, competencies, attestations, externalTraining, credentials, equivalencies, corrections] = await Promise.all([
    prisma.trainingCompletion.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, completedAt: true } }),
    prisma.competencyAssessment.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, finalizedAt: true } }),
    prisma.attestation.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, signedAt: true } }),
    prisma.externalTrainingRecord.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, trainingDate: true, expiresAt: true } }),
    prisma.professionalCredential.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, verifiedAt: true, issuedAt: true, expiresAt: true } }),
    prisma.requirementEquivalencyDecision.findMany({ where: { organizationId, id: { in: ids } }, include: { externalTrainingRecord: { select: { trainingDate: true, expiresAt: true } } } }),
    prisma.evidenceCorrection.findMany({ where: { organizationId, resourceId: { in: ids }, correctionType: { in: ["VOIDED", "SUPERSEDED", "CORRECTED_BY_REPLACEMENT"] } }, select: { resourceId: true } }),
  ]);
  const corrected = new Set(corrections.map(item => item.resourceId));
  return links.map(link => {
    let evidenceDate: Date | null = null, expiresAt: Date | null = null;
    if (link.evidenceType === "TRAINING_COMPLETION") evidenceDate = completions.find(item => item.id === link.evidenceReferenceId)?.completedAt ?? null;
    else if (link.evidenceType === "COMPETENCY_ASSESSMENT") evidenceDate = competencies.find(item => item.id === link.evidenceReferenceId)?.finalizedAt ?? null;
    else if (link.evidenceType === "ATTESTATION") evidenceDate = attestations.find(item => item.id === link.evidenceReferenceId)?.signedAt ?? null;
    else if (link.evidenceType === "EXTERNAL_TRAINING") { const item = externalTraining.find(row => row.id === link.evidenceReferenceId); evidenceDate = item?.trainingDate ?? null; expiresAt = item?.expiresAt ?? null; }
    else if (link.evidenceType === "EXTERNAL_CREDENTIAL") { const item = credentials.find(row => row.id === link.evidenceReferenceId); evidenceDate = item?.verifiedAt ?? item?.issuedAt ?? null; expiresAt = item?.expiresAt ?? null; }
    else if (link.evidenceType === "EQUIVALENCY_DECISION") { const item = equivalencies.find(row => row.id === link.evidenceReferenceId); evidenceDate = item?.decidedAt ?? item?.externalTrainingRecord.trainingDate ?? null; expiresAt = item?.externalTrainingRecord.expiresAt ?? null; }
    return { type: link.evidenceType, referenceId: link.evidenceReferenceId, evidenceDate: evidenceDate?.toISOString() ?? null, expiresAt: expiresAt?.toISOString() ?? null, temporalStatus: deriveTemporalStatus({ expiresAt, evaluatedAt, timeZone }), corrected: corrected.has(link.evidenceReferenceId) };
  });
}

function deriveRequirementStatus(instance: { status: string; nominalDueAt: Date | null; hardBlockAt: Date | null; requirementVersion: { blockingScope: BlockingScope | null } }, evidence: EvidenceBasis[], evaluatedAt: Date, timeZone: string): OperationalStatus {
  if (evidence.some(item => !item.corrected && item.temporalStatus === "EXPIRED")) return "BLOCKED";
  if (instance.status === "SATISFIED" || instance.status === "WAIVED_BY_EQUIVALENCY") return evidence.some(item => !item.corrected && item.temporalStatus === "EXPIRING_SOON") ? "EXPIRING_SOON" : "READY";
  if (instance.status === "BLOCKED" || instance.status === "EXPIRED" || (instance.hardBlockAt && instance.hardBlockAt <= evaluatedAt)) return "BLOCKED";
  if (instance.status === "PAST_DUE" || deriveTemporalStatus({ dueAt: instance.nominalDueAt, evaluatedAt, timeZone }) === "OVERDUE") return "OVERDUE";
  if (["ASSIGNED", "IN_PROGRESS", "WITHIN_LEGAL_DELAY"].includes(instance.status)) return "ACTION_REQUIRED";
  return "NOT_READY";
}

function trainingRemediation(instance: { id: string; requirementVersionId: string; status: string; trainingAssignments: { id: string; status: string; completion: unknown; attempts: { submittedAt: Date | null; passed: boolean | null }[] }[]; requirementVersion: { competencyRequirements: { required: boolean }[]; competencyDefinition: Prisma.JsonValue; trainingOptions: { id: string }[] }; competencyAssessments: { status: string; result: string | null }[] }): RemediationAction[] {
  if (["SATISFIED", "WAIVED_BY_EQUIVALENCY"].includes(instance.status)) return [];
  const current = instance.trainingAssignments.find(assignment => !["CANCELLED", "SUPERSEDED"].includes(assignment.status));
  if (!current && instance.requirementVersion.trainingOptions.length) return [{ type: "ASSIGN_REQUIRED_TRAINING", resourceType: "ComplianceInstance", resourceId: instance.id, requirementVersionId: instance.requirementVersionId, executable: true, message: "Assign the active mapped training version." }];
  if (current && !current.completion) {
    const failed = current.attempts.some(attempt => attempt.submittedAt && attempt.passed === false);
    return [{ type: failed ? "RETAKE_FAILED_ASSESSMENT" : "RESUME_INCOMPLETE_TRAINING", resourceType: "TrainingAssignment", resourceId: current.id, requirementVersionId: instance.requirementVersionId, executable: false, message: failed ? "Retake the failed assessment under the assigned version rules." : "Resume the incomplete version-pinned training assignment." }];
  }
  const legacyCompetency = (instance.requirementVersion.competencyDefinition as { type?: string } | null)?.type === "REQUIRED";
  const competencyRequired = legacyCompetency || instance.requirementVersion.competencyRequirements.some(item => item.required);
  if (current?.completion && competencyRequired && !instance.competencyAssessments.some(item => item.status === "FINALIZED" && item.result === "PASS")) return [{ type: "COMPLETE_COMPETENCY_ASSESSMENT", resourceType: "ComplianceInstance", resourceId: instance.id, requirementVersionId: instance.requirementVersionId, executable: false, message: "Complete an authorized competency assessment and assessor sign-off." }, { type: "OBTAIN_ASSESSOR_SIGN_OFF", resourceType: "ComplianceInstance", resourceId: instance.id, requirementVersionId: instance.requirementVersionId, executable: false, message: "Obtain sign-off from an authorized assessor." }];
  return [{ type: "UPLOAD_VERIFY_EXTERNAL_EVIDENCE", resourceType: "ComplianceInstance", resourceId: instance.id, requirementVersionId: instance.requirementVersionId, executable: false, message: "Provide and verify acceptable evidence for this requirement." }];
}

export async function computeEmployeeOperationalProfile(organizationId: string, employeeId: string, evaluatedAt = new Date()) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: {
    organization: true,
    complianceInstances: { where: { status: { not: "SUPERSEDED" } }, include: { evidence: true, ruleset: true, requirementVersion: { include: { requirement: true, authorityMappings: { include: { regulationVersion: { include: { regulation: true } } } }, trainingOptions: true, competencyRequirements: true } }, trainingAssignments: { include: { completion: true, attempts: true } }, competencyAssessments: true } },
    policyAssignments: { where: { status: { in: ["PENDING", "OVERDUE"] } }, include: { policyVersion: { include: { policy: true } } } },
    onboardings: { where: { status: { notIn: ["COMPLETED", "CANCELED"] } }, include: { steps: { include: { stepDefinition: true } } } },
  } });
  if (!employee) throw new ResourceNotFoundError("Employee not found");
  const requirements = [];
  for (const instance of employee.complianceInstances) {
    const evidence = await resolveEvidence(organizationId, instance.evidence, evaluatedAt, employee.organization.timezone);
    const status = deriveRequirementStatus(instance, evidence, evaluatedAt, employee.organization.timezone);
    const blocking = Boolean(instance.requirementVersion.blockingScope && ["BLOCKED", "OVERDUE"].includes(status));
    const remediations = trainingRemediation(instance);
    if (evidence.some(item => item.temporalStatus === "EXPIRED")) remediations.unshift({ type: "RENEW_EXPIRED_CREDENTIAL", resourceType: "ComplianceInstance", resourceId: instance.id, requirementVersionId: instance.requirementVersionId, executable: false, message: "Renew and verify expired supporting evidence." });
    requirements.push({ complianceInstanceId: instance.id, requirementId: instance.requirementVersion.requirementId, requirementVersionId: instance.requirementVersionId, code: instance.requirementVersion.requirement.code, name: instance.requirementVersion.requirement.name, version: instance.requirementVersion.versionNumber, status, sourceStatus: instance.status, applicabilityBasis: { triggerType: instance.triggerType, triggerReference: instance.triggerReference, requiredAt: instance.requiredAt.toISOString() }, citations: instance.requirementVersion.authorityMappings.map(mapping => ({ citation: mapping.regulationVersion.regulation.citation, title: mapping.regulationVersion.regulation.title, sourceUrl: mapping.regulationVersion.sourceUrl, note: mapping.citationNote })), dueAt: instance.nominalDueAt?.toISOString() ?? null, overdue: status === "OVERDUE", expiringSoon: status === "EXPIRING_SOON", blocking, blockingScope: instance.requirementVersion.blockingScope, evidence, remediations, rulesetId: instance.rulesetId, rulesetVersion: instance.ruleset.version, lastEvaluatedAt: instance.lastEvaluatedAt.toISOString() });
  }
  const policyRemediations: RemediationAction[] = employee.policyAssignments.map(item => ({ type: "ACKNOWLEDGE_REQUIRED_POLICY", resourceType: "PolicyAssignment", resourceId: item.id, executable: false, message: `Acknowledge ${item.policyVersion.policy.title}.` }));
  const onboardingRemediations: RemediationAction[] = employee.onboardings.flatMap(onboarding => onboarding.steps.filter(step => step.stepDefinition.required && !["COMPLETED", "NOT_APPLICABLE"].includes(step.status)).map(step => ({ type: "COMPLETE_ONBOARDING_STEP" as const, resourceType: "EmployeeOnboardingStep", resourceId: step.id, executable: false, message: `Complete onboarding step: ${step.stepDefinition.name}.` })));
  const readiness = await computeEmployeeWorkReadiness(organizationId, employeeId, evaluatedAt);
  const remediations = [...requirements.flatMap(item => item.remediations), ...policyRemediations, ...onboardingRemediations];
  const blocked = readiness.scopes.some(scope => scope.state === "BLOCKED") || requirements.some(item => item.blocking);
  const readinessPending = readiness.scopes.some(scope => scope.state === "REQUIREMENTS_PENDING");
  const overallStatus: OperationalStatus = blocked ? "BLOCKED" : requirements.some(item => item.status === "OVERDUE") ? "OVERDUE" : requirements.some(item => item.status === "EXPIRING_SOON") ? "EXPIRING_SOON" : remediations.length ? "ACTION_REQUIRED" : readinessPending || requirements.length === 0 ? "REQUIREMENTS_PENDING" : requirements.every(item => item.status === "READY") && readiness.scopes.filter(scope => scope.state !== "NOT_APPLICABLE" && scope.scope !== "MEDICATION_ADMINISTRATION").every(scope => scope.state === "READY") ? "READY" : "NOT_READY";
  return { organizationId, employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, employeeNumber: employee.employeeNumber }, evaluatedAt: evaluatedAt.toISOString(), engineVersion: COMPLIANCE_OPERATIONS_ENGINE_VERSION, expiringSoonDays: getExpiringSoonDays(), overallStatus, requirements, remediations, readiness };
}

async function authorizeEmployee(user: Pick<User, "id">, organizationId: string, employeeId: string, permission: string) { await requireEmployeeAccess(user, organizationId, employeeId, permission); }

export async function getEmployeeOperationalProfile(user: Pick<User, "id">, organizationId: string, employeeId: string, evaluatedAt = new Date()) { await authorizeEmployee(user, organizationId, employeeId, "compliance.operations.read"); return computeEmployeeOperationalProfile(organizationId, employeeId, evaluatedAt); }

export async function evaluateEmployeeOperations(user: Pick<User, "id">, organizationId: string, employeeId: string, evaluatedAt = new Date()) {
  await authorizeEmployee(user, organizationId, employeeId, "work_readiness.evaluate");
  await evaluateEmployeeCompliance(organizationId, employeeId, "MANUAL", evaluatedAt);
  const profile = await computeEmployeeOperationalProfile(organizationId, employeeId, evaluatedAt);
  const readiness = await evaluateEmployeeWorkReadiness(organizationId, employeeId, "MANUAL_REEVALUATION", evaluatedAt);
  await prisma.workReadinessEvaluation.update({ where: { id: readiness.snapshot.id }, data: { resultJson: { ...profile, operation: "OPERATIONAL_COMPLIANCE_EVALUATION" } as unknown as Prisma.InputJsonValue, engineVersion: COMPLIANCE_OPERATIONS_ENGINE_VERSION } });
  return { snapshotId: readiness.snapshot.id, profile };
}

export async function executeRemediation(user: Pick<User, "id">, organizationId: string, employeeId: string, complianceInstanceId: string, remediationType: RemediationType) {
  await authorizeEmployee(user, organizationId, employeeId, "training.assignment.manage");
  if (remediationType !== "ASSIGN_REQUIRED_TRAINING") throw new AuthorizationError("This remediation requires human or separately authorized evidence action");
  const instance = await prisma.complianceInstance.findFirst({ where: { id: complianceInstanceId, organizationId, employeeId } });
  if (!instance) throw new ResourceNotFoundError("Compliance instance not found");
  const assignment = await assignTrainingForCompliance(instance.id);
  if (!assignment) throw new ResourceNotFoundError("No active mapped training version is available");
  await evaluateEmployeeWorkReadiness(organizationId, employeeId, "COMPLIANCE_CHANGED");
  return assignment;
}

export async function evaluateServiceEligibility(user: Pick<User, "id">, organizationId: string, employeeId: string, scope: BlockingScope, evaluatedAt = new Date()) {
  await authorizeEmployee(user, organizationId, employeeId, "compliance.operations.read");
  const profile = await computeEmployeeOperationalProfile(organizationId, employeeId, evaluatedAt);
  const applicable = profile.requirements.filter(item => item.blockingScope && scopeAffected(item.blockingScope, scope));
  const blocking = applicable.filter(item => item.blocking);
  const readinessScope = profile.readiness.scopes.find(item => item.scope === scope);
  const medicationBoundary = scope === "MEDICATION_ADMINISTRATION";
  const eligible = !medicationBoundary && !blocking.length && readinessScope?.state === "READY";
  const decision = { eligible, evaluatedAt: evaluatedAt.toISOString(), scope, engineVersion: COMPLIANCE_OPERATIONS_ENGINE_VERSION, applicableRequirements: applicable.map(item => item.requirementVersionId), blockingRequirements: blocking.map(item => item.requirementVersionId), reasonCodes: [...new Set([...blocking.map(item => `REQUIREMENT_${item.status}`), ...(readinessScope?.reasons.map(reason => reason.type) ?? []), ...(medicationBoundary ? ["EVIDENCE_COMPLETE_AUTHORIZATION_NOT_IMPLEMENTED"] : [])])], evidenceBasis: applicable.flatMap(item => item.evidence), disclaimer: "Platform-derived readiness based on configured requirements and recorded evidence; not a legal opinion." };
  await prisma.workReadinessEvaluation.create({ data: { organizationId, employeeId, evaluatedAt, evaluationTrigger: "MANUAL_REEVALUATION", resultJson: { operation: "SERVICE_ELIGIBILITY_EVALUATION", decision } as unknown as Prisma.InputJsonValue, engineVersion: COMPLIANCE_OPERATIONS_ENGINE_VERSION } });
  return decision;
}

export async function getOrganizationComplianceOperations(user: Pick<User, "id">, organizationId: string, filters: { status?: OperationalStatus; scope?: BlockingScope } = {}, evaluatedAt = new Date()) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "compliance.operations.read");
  const employees = await prisma.employee.findMany({ where: { organizationId, employmentStatus: { not: "ARCHIVED" } }, select: { id: true } });
  const profiles = await Promise.all(employees.map(employee => computeEmployeeOperationalProfile(organizationId, employee.id, evaluatedAt)));
  const filtered = profiles.filter(profile => (!filters.status || profile.overallStatus === filters.status) && (!filters.scope || profile.readiness.scopes.find(item => item.scope === filters.scope)?.state === "BLOCKED"));
  const count = (status: OperationalStatus) => profiles.filter(profile => profile.overallStatus === status).length;
  return { organizationId, evaluatedAt: evaluatedAt.toISOString(), counts: { totalWorkforce: profiles.length, ready: count("READY"), notReady: count("NOT_READY"), actionRequired: count("ACTION_REQUIRED"), overdue: count("OVERDUE"), expiringSoon: count("EXPIRING_SOON"), blocked: count("BLOCKED") }, workers: filtered.map(profile => ({ employee: profile.employee, status: profile.overallStatus, blockingRequirementCount: profile.requirements.filter(item => item.blocking).length, remediationCount: profile.remediations.length })) };
}
