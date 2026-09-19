import { createHash } from "node:crypto";
import { Prisma, type AuditPackageScope, type User } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { getComplianceOperationsSummary } from "@/domain/operations/service";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
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
  return membership;
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
  const membership = await authorize(user, organizationId, "audit.read"), permissions = await resolvePermissionCodes(membership.id), clinicalAuthorized = permissions.has("clinical.review");
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
    prisma.evidenceCorrection.findMany({ where: { organizationId, createdAt: before(at) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 2000 }),
  ]);
  const requirementTraces = await Promise.all(instances.map(instance => getRequirementEvidenceTrace(user, organizationId, instance.requirementVersionId, employeeId, view)));
  const gaps: { code: EvidenceGapCode; detail: string; resourceId?: string }[] = requirementTraces.flatMap(trace => trace.deficiencies.map(gap => ({ code: gap.code, detail: `No satisfying evidence is recorded for ${trace.requirement.code}.`, resourceId: trace.requirement.versionId })));
  if (at) gaps.push({ code: "HISTORICAL_STATE_NOT_RECONSTRUCTABLE", detail: "Employment status is a mutable field without a complete status-event history; the exported value is labeled as currently stored." });
  const credentialRecords = credentials.map(item => ({ ...item, validityAtRequestedTime: !at ? undefined : activeAt(item.issuedAt, item.expiresAt, at) && !["ARCHIVED", "INACTIVE"].includes(item.status) }));
  const relatedResourceIds = new Set([employeeId, ...instances.map(item => item.id), ...assignments.flatMap(item => [item.id, ...(item.completion ? [item.completion.id] : [])]), ...attempts.map(item => item.id), ...competencies.map(item => item.id), ...credentials.map(item => item.id), ...externalTraining.flatMap(item => [item.id, ...item.equivalencyDecisions.map(decision => decision.id)]), ...attestations.map(item => item.id), ...policies.map(item => item.id), ...issues.map(item => item.id), ...certificates.map(item => item.id)]);
  return {
    exportMetadata: { schemaVersion: "phase12-v1", view: view.mode, asOf: at?.toISOString() ?? new Date().toISOString(), generatedFromRecordsAt: new Date().toISOString() },
    employee: { ...employee, historicalLimitation: at ? "employmentStatus is the currently stored value" : null }, regulatoryApplicability: instances.map(item => ({ complianceInstanceId: item.id, requirementVersionId: item.requirementVersionId, rulesetId: item.rulesetId, requiredAt: item.requiredAt, status: item.status, lastEvaluatedAt: item.lastEvaluatedAt })), requirements: requirementTraces,
    training: assignments, assessments: attempts, competency: competencies, credentials: credentialRecords, equivalencies: externalTraining, attestations,
    onboarding: onboardings, policies, readinessEvaluations: readiness,
    medicationGovernance: clinicalAuthorized ? { training: assignments.filter(item => item.courseVersion.course.category === "MEDICATION"), knowledge: attempts.filter(item => assignments.some(assignment => assignment.id === item.trainingAssignmentId && assignment.courseVersion.course.category === "MEDICATION")), observedSkill: competencies, clinicalSignOffs: qualifications.map(item => ({ qualificationId: item.id, reviewerCredentialId: item.reviewerCredentialId, attestationId: item.attestationId, qualifiedAt: item.qualifiedAt })), qualifications, personSpecificInstruction: instructions, administrationAuthorization: authorizations } : { access: "REDACTED", reason: "clinical.review permission required" },
    assignments: serviceAssignments, complianceIssues: issues, certificates, evidenceCorrections: corrections.filter(item => relatedResourceIds.has(item.resourceId) || Boolean(item.replacementResourceId && relatedResourceIds.has(item.replacementResourceId))),
    materialAuditHistory: { training: assignments.flatMap(item => item.events), clinical: [], assignments: serviceAssignments.flatMap(item => item.events), remediation: issues.flatMap(item => item.events) }, knownEvidenceGaps: gaps,
  };
}

export async function getOrganizationAuditSummary(user: Pick<User, "id">, organizationId: string, at = new Date()) {
  await authorize(user, organizationId, "audit.read");
  return { schemaVersion: "phase12-v1", generatedAt: new Date().toISOString(), summary: await getComplianceOperationsSummary(user, organizationId, at) };
}

export type AuditDomain = "WORKFORCE" | "TRAINING" | "POLICIES" | "EVIDENCE" | "REMEDIATION" | "ASSIGNMENTS" | "NOTIFICATIONS" | "AUDIT_HISTORY";
const DEFAULT_DOMAINS: AuditDomain[] = ["WORKFORCE", "TRAINING", "POLICIES", "EVIDENCE", "REMEDIATION", "ASSIGNMENTS"];
const PACKAGE_RECORD_LIMIT = 2000;
function dateWindow(from?: Date, to?: Date) { return from || to ? { gte: from, lte: to } : undefined; }
function bounded<T>(label: string, rows: T[]) { if (rows.length > PACKAGE_RECORD_LIMIT) throw new AuthorizationError(`${label} exceeds ${PACKAGE_RECORD_LIMIT} records; narrow the package scope or date range`); return rows; }

async function getOrganizationAuditRecord(user: Pick<User, "id">, organizationId: string, domains: AuditDomain[], rangeFrom?: Date, rangeTo?: Date) {
  const membership = await authorize(user, organizationId, "audit.export"), permissions = await resolvePermissionCodes(membership.id), clinical = permissions.has("clinical.review"), take = PACKAGE_RECORD_LIMIT + 1;
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, legalName: true, displayName: true, timezone: true, status: true, licenses: true } });
  const record: Record<string, unknown> = { organization, disclaimer: "Platform record export only; not regulatory approval, audit passage, or legal certification." };
  if (domains.includes("WORKFORCE")) record.workforce = bounded("Workforce", await prisma.employee.findMany({ where: { organizationId, createdAt: dateWindow(undefined, rangeTo) }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, employmentStatus: true, employmentType: true, hireDate: true, terminationDate: true, createdAt: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], take }));
  if (domains.includes("TRAINING")) record.training = bounded("Training", await prisma.trainingAssignment.findMany({ where: { organizationId, assignedAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, courseVersionId: true, status: true, assignedAt: true, dueAt: true, completedAt: true, courseVersion: { select: { versionNumber: true, contentHash: true, course: { select: { code: true, title: true } } } }, completion: { select: { id: true, completedAt: true, completionMethod: true, contentHash: true } } }, orderBy: [{ assignedAt: "asc" }, { id: "asc" }], take }));
  if (domains.includes("POLICIES")) record.policies = bounded("Policies", await prisma.policyAssignment.findMany({ where: { organizationId, assignedAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, policyVersionId: true, assignedAt: true, dueAt: true, status: true, acknowledgedAt: true, policyVersion: { select: { versionNumber: true, contentHash: true, status: true, policy: { select: { code: true, title: true } } } }, attestation: { select: { id: true, signedAt: true, statementVersion: true, signatureHash: true } } }, orderBy: [{ assignedAt: "asc" }, { id: "asc" }], take }));
  if (domains.includes("EVIDENCE")) record.evidence = {
    credentials: bounded("Credentials", await prisma.professionalCredential.findMany({ where: { organizationId, createdAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, credentialType: true, credentialName: true, issuedAt: true, expiresAt: true, verificationStatus: true, verifiedAt: true, status: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take })),
    competency: bounded("Competency", await prisma.competencyAssessment.findMany({ where: { organizationId, startedAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, competencyDefinitionId: true, skillChecklistVersionId: true, status: true, result: true, startedAt: true, finalizedAt: true }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take })),
    externalTraining: bounded("External training", await prisma.externalTrainingRecord.findMany({ where: { organizationId, createdAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, providerName: true, trainingName: true, trainingDate: true, reviewStatus: true, reviewedAt: true, equivalencyDecisions: { select: { id: true, requirementVersionId: true, decision: true, competencyVerified: true, reason: true, decidedAt: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take })),
    corrections: bounded("Corrections", await prisma.evidenceCorrection.findMany({ where: { organizationId, createdAt: dateWindow(rangeFrom, rangeTo) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take })),
  };
  if (domains.includes("REMEDIATION")) record.remediation = bounded("Remediation", await prisma.complianceIssue.findMany({ where: { organizationId, firstDetectedAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, issueType: true, priority: true, status: true, sourceType: true, sourceId: true, dueAt: true, firstDetectedAt: true, latestDetectedAt: true, resolvedAt: true, resolutionReason: true, events: { select: { action: true, snapshotJson: true, createdAt: true }, orderBy: { createdAt: "asc" } } }, orderBy: [{ firstDetectedAt: "asc" }, { id: "asc" }], take }));
  if (domains.includes("ASSIGNMENTS")) record.assignments = bounded("Assignments", await prisma.serviceAssignment.findMany({ where: { organizationId, createdAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, employeeId: true, blockingScope: true, status: true, startsAt: true, endsAt: true, createdAt: true, eligibilityEvaluations: { select: { decision: true, evaluatedAt: true, engineVersion: true, resultSnapshot: clinical }, orderBy: { evaluatedAt: "asc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take }));
  if (domains.includes("NOTIFICATIONS")) record.notifications = bounded("Notifications", await prisma.notification.findMany({ where: { organizationId, generatedAt: dateWindow(rangeFrom, rangeTo), ...(clinical ? {} : { audience: { not: "CLINICAL" } }) }, select: { id: true, recipientUserId: true, audience: true, notificationType: true, severity: true, sourceType: true, sourceId: true, dueAt: true, escalationLevel: true, status: true, generatedAt: true, resolvedAt: true, deliveries: { select: { channel: true, status: true, attemptCount: true, sentAt: true } } }, orderBy: [{ generatedAt: "asc" }, { id: "asc" }], take }));
  if (domains.includes("AUDIT_HISTORY")) record.auditHistory = bounded("Audit history", await prisma.auditEvent.findMany({ where: { organizationId, occurredAt: dateWindow(rangeFrom, rangeTo) }, select: { id: true, actorUserId: true, employeeId: true, eventType: true, entityType: true, entityId: true, occurredAt: true }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take }));
  return record;
}

function countPackageRecords(value: unknown): number { if (Array.isArray(value)) return value.length + value.reduce<number>((sum, item) => sum + countPackageRecords(item), 0); if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countPackageRecords(item), 0); return 0; }

export async function createAuditPackage(user: Pick<User, "id">, organizationId: string, input: { scope: AuditPackageScope; subjectId?: string; pointInTimeAt?: Date; rangeFrom?: Date; rangeTo?: Date; includedDomains?: AuditDomain[] }) {
  await authorize(user, organizationId, "audit.export");
  if (input.rangeFrom && input.rangeTo && input.rangeFrom > input.rangeTo) throw new AuthorizationError("Audit package rangeFrom must not be after rangeTo");
  const includedDomains = [...new Set(input.includedDomains?.length ? input.includedDomains : DEFAULT_DOMAINS)];
  const pending = await prisma.auditPackage.create({ data: { organizationId, scope: input.scope, requestedByUserId: user.id, subjectType: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? "Employee" : input.scope === "REQUIREMENT_EVIDENCE_RECORD" ? "ComplianceRequirementVersion" : "Organization", subjectId: input.subjectId ?? (input.scope === "ORGANIZATION_COMPLIANCE_SUMMARY" ? organizationId : null), pointInTimeAt: input.pointInTimeAt, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo, includedDomains, reportVersion: "phase22-v1" } });
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? input.subjectId : null, eventType: "audit.package_requested", entityType: "AuditPackage", entityId: pending.id, metadataJson: { scope: input.scope, includedDomains, rangeFrom: input.rangeFrom?.toISOString() ?? null, rangeTo: input.rangeTo?.toISOString() ?? null, pointInTimeAt: input.pointInTimeAt?.toISOString() ?? null } } });
  try {
    const view: AuditView = input.pointInTimeAt ? { mode: "POINT_IN_TIME", at: input.pointInTimeAt } : { mode: "CURRENT" };
    const record = input.scope === "EMPLOYEE_COMPLIANCE_RECORD" && input.subjectId ? await getEmployeeAuditRecord(user, organizationId, input.subjectId, view) : input.scope === "REQUIREMENT_EVIDENCE_RECORD" && input.subjectId ? await getRequirementEvidenceTrace(user, organizationId, input.subjectId, undefined, view) : input.scope === "ORGANIZATION_COMPLIANCE_SUMMARY" ? { summary: { schemaVersion: "phase22-v1", generatedAt: new Date().toISOString(), meaning: "Bounded organization records in the explicitly selected domains; no generic compliance score or regulatory conclusion." }, records: await getOrganizationAuditRecord(user, organizationId, includedDomains, input.rangeFrom, input.rangeTo) } : (() => { throw new ResourceNotFoundError("Audit package subject is required"); })();
    const recordCount = countPackageRecords(record), manifest = { schemaVersion: "phase22-v1", packageId: pending.id, organizationId, scope: input.scope, subjectType: pending.subjectType, subjectId: pending.subjectId, requestedByUserId: user.id, requestedAt: pending.requestedAt.toISOString(), pointInTimeAt: input.pointInTimeAt?.toISOString() ?? null, rangeFrom: input.rangeFrom?.toISOString() ?? null, rangeTo: input.rangeTo?.toISOString() ?? null, includedDomains, recordCount, limitations: ["Mutable fields without append-only history are not represented as exact historical reconstruction.", "This package reflects platform records and is not regulatory approval, audit passage, or legal certification."], record };
    const persistedManifest = JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue, integrityDigest = auditManifestDigest(persistedManifest), generatedAt = new Date();
    const result = await prisma.auditPackage.update({ where: { id: pending.id }, data: { status: "GENERATED", generatedAt, manifestJson: persistedManifest, integrityDigest, recordCount } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: input.scope === "EMPLOYEE_COMPLIANCE_RECORD" ? input.subjectId : null, eventType: "audit.package_generated", entityType: "AuditPackage", entityId: pending.id, metadataJson: { integrityDigest, scope: input.scope, includedDomains, recordCount } } });
    return result;
  } catch (error) {
    await prisma.auditPackage.update({ where: { id: pending.id }, data: { status: "FAILED", generationErrors: [{ message: error instanceof Error ? error.message : "Unknown generation error" }] } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "audit.package_failed", entityType: "AuditPackage", entityId: pending.id, metadataJson: { message: error instanceof Error ? error.message : "Unknown generation error" } } });
    throw error;
  }
}

export async function getAuditPackage(user: Pick<User, "id">, organizationId: string, packageId: string, includeManifest = false) {
  await authorize(user, organizationId, includeManifest ? "audit.export" : "audit.read");
  const result = await prisma.auditPackage.findFirst({ where: { id: packageId, organizationId }, select: { id: true, organizationId: true, scope: true, requestedByUserId: true, subjectType: true, subjectId: true, pointInTimeAt: true, rangeFrom: true, rangeTo: true, includedDomains: true, reportVersion: true, recordCount: true, status: true, requestedAt: true, generatedAt: true, integrityDigest: true, generationErrors: true, manifestJson: includeManifest } });
  if (!result) throw new ResourceNotFoundError("Audit package not found");
  if (includeManifest && result.manifestJson && result.integrityDigest && auditManifestDigest(result.manifestJson) !== result.integrityDigest) throw new AuthorizationError("Audit package integrity verification failed");
  if (includeManifest) await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: result.subjectType === "Employee" ? result.subjectId : null, eventType: "audit.package_accessed", entityType: "AuditPackage", entityId: result.id } });
  return result;
}

export async function verifyAuditPackageIntegrity(user: Pick<User, "id">, organizationId: string, packageId: string) {
  const result = await getAuditPackage(user, organizationId, packageId, true);
  return { packageId: result.id, algorithm: "SHA-256", verified: Boolean(result.manifestJson && result.integrityDigest && auditManifestDigest(result.manifestJson) === result.integrityDigest), digest: result.integrityDigest };
}

export async function queryAuditEvents(user: Pick<User, "id">, organizationId: string, filters: { employeeId?: string; actorUserId?: string; eventType?: string; entityType?: string; entityId?: string; from?: Date; to?: Date; limit?: number } = {}) {
  await authorize(user, organizationId, "audit.read");
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 100));
  return prisma.auditEvent.findMany({ where: { organizationId, employeeId: filters.employeeId, actorUserId: filters.actorUserId, eventType: filters.eventType, entityType: filters.entityType, entityId: filters.entityId, occurredAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined }, orderBy: { occurredAt: "desc" }, take: limit });
}
