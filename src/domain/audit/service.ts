import { createHash } from "node:crypto";
import { Prisma, type AuditPackageScope, type User } from "@prisma/client";
import { ResourceNotFoundError } from "@/domain/auth/errors";
import { getComplianceOperationsSummary } from "@/domain/operations/service";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export type AuditView = { mode: "CURRENT" } | { mode: "POINT_IN_TIME"; at: Date };
export type EvidenceGapCode = "REQUIRED_EVIDENCE_MISSING" | "HISTORICAL_STATE_NOT_RECONSTRUCTABLE" | "SOURCE_RECORD_UNAVAILABLE" | "REQUIREMENT_NOT_MAPPED";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

/** SHA-256 protects the canonical manifest bytes against undetected alteration.
 * It does not authenticate the requester, sign attachments, or provide PKI/non-repudiation. */
export function auditManifestDigest(manifest: unknown) {
  return createHash("sha256").update(canonicalize(manifest)).digest("hex");
}

async function authorize(user: Pick<User, "id">, organizationId: string, permission: "audit.read" | "audit.export") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
}

const before = (at?: Date) => at ? { lte: at } : undefined;
const activeAt = (from: Date | null, until: Date | null, at: Date) => (!from || from <= at) && (!until || until >= at);

export async function getRequirementEvidenceTrace(user: Pick<User, "id">, organizationId: string, requirementVersionId: string, employeeId?: string, view: AuditView = { mode: "CURRENT" }) {
  await authorize(user, organizationId, "audit.read");
  if (employeeId) await requireEmployeeAccess(user, organizationId, employeeId, "employee.read");
  const at = view.mode === "POINT_IN_TIME" ? view.at : undefined;
  const version = await prisma.complianceRequirementVersion.findFirst({
    where: { id: requirementVersionId },
    include: {
      requirement: true,
      authorityMappings: { include: { regulationVersion: { include: { regulation: { include: { authority: true } } } } } },
      rulesets: { include: { ruleset: true } },
      trainingOptions: { include: { trainingCourseVersion: { include: { course: true, learningObjectives: true } } } },
      competencyRequirements: { include: { competencyDefinition: true } },
      complianceInstances: { where: { organizationId, employeeId, createdAt: before(at) }, include: { evidence: { where: { createdAt: before(at) } }, trainingAssignments: { include: { completion: { where: { completedAt: before(at) } } } }, competencyAssessments: true } },
      equivalencyDecisions: { where: { organizationId, externalTrainingRecord: employeeId ? { employeeId } : undefined, decidedAt: before(at) }, include: { externalTrainingRecord: true } },
    },
  });
  if (!version) throw new ResourceNotFoundError("Requirement version not found");
  const evidence = version.complianceInstances.flatMap(instance => [
    ...instance.evidence.map(item => ({ type: item.evidenceType, referenceId: item.evidenceReferenceId, timestamp: item.createdAt, provenance: "REGULATORY_EVALUATION" })),
    ...instance.trainingAssignments.filter(item => item.completion && (!at || item.completion.completedAt <= at)).map(item => ({ type: "TRAINING_COMPLETION", referenceId: item.completion!.id, timestamp: item.completion!.completedAt, provenance: "INTERNALLY_GENERATED" })),
    ...instance.competencyAssessments.filter(item => item.finalizedAt && (!at || item.finalizedAt <= at)).map(item => ({ type: "COMPETENCY_ASSESSMENT", referenceId: item.id, timestamp: item.finalizedAt!, provenance: "COMPETENCY_ASSESSMENT" })),
  ]);
  const satisfied = version.complianceInstances.some(instance => ["SATISFIED", "WAIVED_BY_EQUIVALENCY"].includes(instance.status) && (!at || (instance.satisfiedAt ?? instance.lastEvaluatedAt) <= at)) || version.equivalencyDecisions.some(item => item.decision === "APPROVED");
  return {
    view: view.mode, asOf: at?.toISOString() ?? new Date().toISOString(), subject: employeeId ? { employeeId } : null,
    authority: version.authorityMappings.map(mapping => ({ relationship: mapping.relationshipType, citationNote: mapping.citationNote, authority: mapping.regulationVersion.regulation.authority, regulation: { id: mapping.regulationVersion.regulation.id, citation: mapping.regulationVersion.regulation.citation, title: mapping.regulationVersion.regulation.title }, regulationVersion: { id: mapping.regulationVersion.id, effectiveFrom: mapping.regulationVersion.effectiveFrom, effectiveUntil: mapping.regulationVersion.effectiveUntil, sourceUrl: mapping.regulationVersion.sourceUrl, contentHash: mapping.regulationVersion.contentHash, verificationStatus: mapping.regulationVersion.verificationStatus } })),
    requirement: { id: version.requirement.id, code: version.requirement.code, name: version.requirement.name, category: version.requirement.requirementCategory, versionId: version.id, versionNumber: version.versionNumber, effectiveFrom: version.effectiveFrom, effectiveUntil: version.effectiveUntil, verificationStatus: version.verificationStatus },
    applicability: { rulesets: version.rulesets.map(link => ({ id: link.ruleset.id, version: link.ruleset.version, licenseType: link.ruleset.licenseType, effectiveFrom: link.ruleset.effectiveFrom, effectiveUntil: link.ruleset.effectiveUntil })), definition: version.applicabilityDefinition },
    obligations: { training: version.trainingOptions.map(option => ({ satisfactionType: option.satisfactionType, courseVersionId: option.trainingCourseVersionId, courseCode: option.trainingCourseVersion.course.code, courseVersion: option.trainingCourseVersion.versionNumber, objectives: option.trainingCourseVersion.learningObjectives.map(objective => ({ id: objective.id, code: objective.code })) })), competency: version.competencyRequirements.map(item => ({ id: item.competencyDefinition.id, code: item.competencyDefinition.code, method: item.competencyDefinition.method, required: item.required })) },
    evidence, evaluation: { satisfied, instances: version.complianceInstances.map(instance => ({ id: instance.id, status: instance.status, evaluatedAt: instance.lastEvaluatedAt, rulesetId: instance.rulesetId })) },
    deficiencies: satisfied ? [] : [{ code: "REQUIRED_EVIDENCE_MISSING" as EvidenceGapCode, requirementVersionId: version.id }],
  };
}

export async function getEmployeeAuditRecord(user: Pick<User, "id">, organizationId: string, employeeId: string, view: AuditView = { mode: "CURRENT" }) {
  await authorize(user, organizationId, "audit.read");
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.read");
  const at = view.mode === "POINT_IN_TIME" ? view.at : undefined;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId, createdAt: before(at) }, select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, preferredName: true, hireDate: true, terminationDate: true, employmentStatus: true, employmentType: true, jobTitle: true, createdAt: true } });
  if (!employee) throw new ResourceNotFoundError("Employee not found");
  const [instances, assignments, attempts, competencies, credentials, externalTraining, attestations, onboardings, policies, readiness, qualifications, instructions, authorizations, serviceAssignments, issues, certificates, corrections] = await Promise.all([
    prisma.complianceInstance.findMany({ where: { organizationId, employeeId, createdAt: before(at) }, include: { requirementVersion: { include: { requirement: true, authorityMappings: { include: { regulationVersion: { include: { regulation: { include: { authority: true } } } } } } } }, evidence: true } }),
    prisma.trainingAssignment.findMany({ where: { organizationId, employeeId, assignedAt: before(at) }, include: { courseVersion: { include: { course: true } }, completion: { where: { completedAt: before(at) }, include: { subjectEvidence: true } }, events: { where: { createdAt: before(at) }, orderBy: { createdAt: "asc" } } } }),
    prisma.assessmentAttempt.findMany({ where: { organizationId, employeeId, startedAt: before(at) }, select: { id: true, trainingAssignmentId: true, assessmentId: true, courseVersionId: true, attemptNumber: true, startedAt: true, submittedAt: true, score: true, maxScore: true, percentage: true, passed: true, resultSnapshot: true } }),
    prisma.competencyAssessment.findMany({ where: { organizationId, employeeId, startedAt: before(at) }, include: { competencyDefinition: true, skillChecklistVersion: true, items: true } }),
    prisma.professionalCredential.findMany({ where: { organizationId, employeeId, createdAt: before(at) }, select: { id: true, credentialType: true, credentialName: true, jurisdiction: true, issuedAt: true, expiresAt: true, verificationStatus: true, verifiedAt: true, evidenceReference: true, status: true, createdAt: true } }),
    prisma.externalTrainingRecord.findMany({ where: { organizationId, employeeId, createdAt: before(at) }, include: { equivalencyDecisions: true } }),
    prisma.attestation.findMany({ where: { organizationId, signerEmployeeId: employeeId, signedAt: before(at) }, select: { id: true, attestationType: true, typedName: true, statementVersion: true, statementSnapshot: true, resourceType: true, resourceId: true, resourceVersionId: true, signedAt: true, signatureHash: true } }),
    prisma.employeeOnboarding.findMany({ where: { organizationId, employeeId, createdAt: before(at) }, include: { templateVersion: { include: { onboardingTemplate: true } }, steps: { include: { stepDefinition: true } } } }),
    prisma.policyAssignment.findMany({ where: { organizationId, employeeId, assignedAt: before(at) }, include: { policyVersion: { include: { policy: true } }, attestation: true } }),
    prisma.workReadinessEvaluation.findMany({ where: { organizationId, employeeId, evaluatedAt: before(at) }, orderBy: { evaluatedAt: "asc" } }),
    prisma.medicationQualification.findMany({ where: { organizationId, employeeId, qualifiedAt: before(at) }, include: { trainingCompletion: true, competencyAssessment: true, skillChecklistVersion: true, reviewerCredential: true, attestation: true } }),
    prisma.personSpecificMedicationInstruction.findMany({ where: { organizationId, employeeId, instructedAt: before(at) }, select: { id: true, serviceRecipientRef: true, procedureReference: true, procedureVersion: true, reviewerUserId: true, reviewerCredentialId: true, attestationId: true, instructedAt: true, effectiveFrom: true, effectiveUntil: true, status: true, evidenceBasis: true } }),
    prisma.medicationAuthorizationEvidence.findMany({ where: { organizationId, employeeId, effectiveFrom: before(at) }, select: { id: true, serviceRecipientRef: true, authorizationType: true, sourceReference: true, recordedByUserId: true, reviewerCredentialId: true, attestationId: true, effectiveFrom: true, effectiveUntil: true, status: true, evidenceBasis: true } }),
    prisma.serviceAssignment.findMany({ where: { organizationId, employeeId, createdAt: before(at) }, include: { program: true, location: true, duties: { include: { dutyDefinition: true } }, requirements: true, eligibilityEvaluations: { where: { evaluatedAt: before(at) }, orderBy: { evaluatedAt: "asc" } }, events: { where: { createdAt: before(at) }, orderBy: { createdAt: "asc" } } } }),
    prisma.complianceIssue.findMany({ where: { organizationId, employeeId, firstDetectedAt: before(at) }, include: { events: { where: { createdAt: before(at) }, orderBy: { createdAt: "asc" } } } }),
    prisma.certificate.findMany({ where: { organizationId, employeeId, issuedAt: before(at) }, select: { id: true, certificateType: true, certificateNumber: true, courseVersionId: true, trainingCompletionId: true, competencyAssessmentId: true, issuedAt: true, expiresAt: true, status: true, certificateSnapshotJson: true } }),
    prisma.evidenceCorrection.findMany({ where: { organizationId, createdAt: before(at), OR: [{ resourceId: employeeId }, { replacementResourceId: employeeId }] } }),
  ]);
  const requirementTraces = await Promise.all(instances.map(instance => getRequirementEvidenceTrace(user, organizationId, instance.requirementVersionId, employeeId, view)));
  const gaps: { code: EvidenceGapCode; detail: string; resourceId?: string }[] = requirementTraces.flatMap(trace => trace.deficiencies.map(gap => ({ code: gap.code, detail: `No satisfying evidence is recorded for ${trace.requirement.code}.`, resourceId: trace.requirement.versionId })));
  if (at) gaps.push({ code: "HISTORICAL_STATE_NOT_RECONSTRUCTABLE", detail: "Employment status is a mutable field without a complete status-event history; the exported value is labeled as currently stored." });
  const credentialRecords = credentials.map(item => ({ ...item, validityAtRequestedTime: !at ? undefined : activeAt(item.issuedAt, item.expiresAt, at) && !["ARCHIVED", "INACTIVE"].includes(item.status) }));
  return {
    exportMetadata: { schemaVersion: "phase12-v1", view: view.mode, asOf: at?.toISOString() ?? new Date().toISOString(), generatedFromRecordsAt: new Date().toISOString() },
    employee: { ...employee, historicalLimitation: at ? "employmentStatus is the currently stored value" : null }, regulatoryApplicability: instances.map(item => ({ complianceInstanceId: item.id, requirementVersionId: item.requirementVersionId, rulesetId: item.rulesetId, requiredAt: item.requiredAt, status: item.status, lastEvaluatedAt: item.lastEvaluatedAt })), requirements: requirementTraces,
    training: assignments, assessments: attempts, competency: competencies, credentials: credentialRecords, equivalencies: externalTraining, attestations,
    onboarding: onboardings, policies, readinessEvaluations: readiness,
    medicationGovernance: { training: assignments.filter(item => item.courseVersion.course.category === "MEDICATION"), knowledge: attempts.filter(item => assignments.some(assignment => assignment.id === item.trainingAssignmentId && assignment.courseVersion.course.category === "MEDICATION")), observedSkill: competencies, clinicalSignOffs: qualifications.map(item => ({ qualificationId: item.id, reviewerCredentialId: item.reviewerCredentialId, attestationId: item.attestationId, qualifiedAt: item.qualifiedAt })), qualifications, personSpecificInstruction: instructions, administrationAuthorization: authorizations },
    assignments: serviceAssignments, complianceIssues: issues, certificates, evidenceCorrections: corrections,
    materialAuditHistory: { training: assignments.flatMap(item => item.events), clinical: [], assignments: serviceAssignments.flatMap(item => item.events), remediation: issues.flatMap(item => item.events) }, knownEvidenceGaps: gaps,
  };
}

export async function getOrganizationAuditSummary(user: Pick<User, "id">, organizationId: string, at = new Date()) {
  await authorize(user, organizationId, "audit.read");
  return { schemaVersion: "phase12-v1", generatedAt: new Date().toISOString(), summary: await getComplianceOperationsSummary(user, organizationId, at) };
}

export async function createAuditPackage(user: Pick<User, "id">, organizationId: string, input: { scope: AuditPackageScope; subjectId?: string; pointInTimeAt?: Date }) {
  await authorize(user, organizationId, "audit.export");
  const pending = await prisma.auditPackage.create({ data: { organizationId, scope: input.scope, requestedByUserId: user.id, subjectType: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? "Employee" : input.scope === "REQUIREMENT_EVIDENCE_RECORD" ? "ComplianceRequirementVersion" : "Organization", subjectId: input.subjectId ?? (input.scope === "ORGANIZATION_COMPLIANCE_SUMMARY" ? organizationId : null), pointInTimeAt: input.pointInTimeAt } });
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? input.subjectId : null, eventType: "audit.package_requested", entityType: "AuditPackage", entityId: pending.id, metadataJson: { scope: input.scope } } });
  try {
    const view: AuditView = input.pointInTimeAt ? { mode: "POINT_IN_TIME", at: input.pointInTimeAt } : { mode: "CURRENT" };
    const record = input.scope === "EMPLOYEE_COMPLIANCE_RECORD" && input.subjectId ? await getEmployeeAuditRecord(user, organizationId, input.subjectId, view) : input.scope === "REQUIREMENT_EVIDENCE_RECORD" && input.subjectId ? await getRequirementEvidenceTrace(user, organizationId, input.subjectId, undefined, view) : input.scope === "ORGANIZATION_COMPLIANCE_SUMMARY" ? await getOrganizationAuditSummary(user, organizationId, input.pointInTimeAt ?? new Date()) : (() => { throw new ResourceNotFoundError("Audit package subject is required"); })();
    const manifest = { schemaVersion: "phase12-v1", packageId: pending.id, organizationId, scope: input.scope, subjectType: pending.subjectType, subjectId: pending.subjectId, requestedByUserId: user.id, requestedAt: pending.requestedAt.toISOString(), pointInTimeAt: input.pointInTimeAt?.toISOString() ?? null, record };
    const integrityDigest = auditManifestDigest(manifest), generatedAt = new Date();
    const result = await prisma.auditPackage.update({ where: { id: pending.id }, data: { status: "GENERATED", generatedAt, manifestJson: manifest as unknown as Prisma.InputJsonValue, integrityDigest } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? input.subjectId : null, eventType: "audit.package_generated", entityType: "AuditPackage", entityId: pending.id, metadataJson: { integrityDigest } } });
    return result;
  } catch (error) {
    await prisma.auditPackage.update({ where: { id: pending.id }, data: { status: "FAILED", generationErrors: [{ message: error instanceof Error ? error.message : "Unknown generation error" }] } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "audit.package_failed", entityType: "AuditPackage", entityId: pending.id, metadataJson: { message: error instanceof Error ? error.message : "Unknown generation error" } } });
    throw error;
  }
}

export async function getAuditPackage(user: Pick<User, "id">, organizationId: string, packageId: string, includeManifest = false) {
  await authorize(user, organizationId, includeManifest ? "audit.export" : "audit.read");
  const result = await prisma.auditPackage.findFirst({ where: { id: packageId, organizationId }, select: { id: true, organizationId: true, scope: true, requestedByUserId: true, subjectType: true, subjectId: true, pointInTimeAt: true, status: true, requestedAt: true, generatedAt: true, integrityDigest: true, generationErrors: true, manifestJson: includeManifest } });
  if (!result) throw new ResourceNotFoundError("Audit package not found");
  if (includeManifest) await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: result.subjectType === "Employee" ? result.subjectId : null, eventType: "audit.package_accessed", entityType: "AuditPackage", entityId: result.id } });
  return result;
}

export async function queryAuditEvents(user: Pick<User, "id">, organizationId: string, filters: { employeeId?: string; actorUserId?: string; eventType?: string; entityType?: string; entityId?: string; from?: Date; to?: Date; limit?: number } = {}) {
  await authorize(user, organizationId, "audit.read");
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 100));
  return prisma.auditEvent.findMany({ where: { organizationId, employeeId: filters.employeeId, actorUserId: filters.actorUserId, eventType: filters.eventType, entityType: filters.entityType, entityId: filters.entityId, occurredAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined }, orderBy: { occurredAt: "desc" }, take: limit });
}
