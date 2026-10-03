import type { User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { createExternalTrainingForEmployee } from "@/domain/evidence/operations";
import { assignMedicationTraining } from "@/domain/medication/service";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { assignTrainingForCompliance, createManualAssignment } from "@/domain/training/assignments/service";
import { prisma } from "@/lib/prisma";

const activeAssignmentStatuses = ["NOT_STARTED", "IN_PROGRESS", "TRAINING_COMPLETE_COMPETENCY_PENDING", "COMPLETED", "FAILED"] as const;
const evidenceInput = z.object({
  providerName: z.string().trim().min(1).max(255),
  trainingName: z.string().trim().min(1).max(255),
  trainingDate: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  credentialNumber: z.string().trim().max(255).optional(),
  evidenceReference: z.string().trim().min(1).max(1000),
  notes: z.string().trim().max(2000).optional(),
}).strict();

async function authorize(user: Pick<User, "id">, organizationId: string, employeeId: string, permission = "training.catalog.read") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.read");
  return membership;
}

function assignmentState(assignments: { status: string; completion: { id: string } | null; assignedAt: Date; dueAt: Date | null }[]) {
  const current = [...assignments].sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime())[0];
  if (!current) return { state: "AVAILABLE" as const, assignment: null };
  return { state: current.completion || current.status === "COMPLETED" ? "COMPLETED" as const : current.status === "FAILED" ? "FAILED" as const : current.status === "IN_PROGRESS" || current.status === "TRAINING_COMPLETE_COMPETENCY_PENDING" ? "IN_PROGRESS" as const : "ASSIGNED" as const, assignment: current };
}

async function registryContext(organizationId: string, at = new Date()) {
  const licenses = await prisma.organizationLicense.findMany({ where: { organizationId, licenseStatus: "ACTIVE", AND: [{ OR: [{ effectiveDate: null }, { effectiveDate: { lte: at } }] }, { OR: [{ expirationDate: null }, { expirationDate: { gte: at } }] }] }, select: { licenseType: true } });
  const licenseTypes = [...new Set(licenses.map(row => row.licenseType))];
  const rulesets = licenseTypes.length ? await prisma.complianceRuleset.findMany({ where: { licenseType: { in: licenseTypes }, status: "ACTIVE", effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }] }, include: { requirements: { include: { requirementVersion: { include: { requirement: true } } } } }, orderBy: [{ licenseType: "asc" }, { version: "desc" }] }) : [];
  const latest = new Map<string, typeof rulesets[number]>();
  for (const ruleset of rulesets) if (!latest.has(ruleset.licenseType)) latest.set(ruleset.licenseType, ruleset);
  const activeRulesets = [...latest.values()], requirementVersions = activeRulesets.flatMap(row => row.requirements.map(link => ({ rulesetId: row.id, licenseType: row.licenseType, ...link.requirementVersion })));
  return { licenseTypes, activeRulesets, requirementVersions };
}

type CatalogAssignment = { status: string; completion: { id: string } | null; assignedAt: Date; dueAt: Date | null };
function courseProjection(course: { id: string; code: string; title: string; description: string | null; category: string; versions: { id: string; versionNumber: number; status: string; estimatedDurationMinutes: number | null; trainingOptions: { complianceRequirementVersion: { id: string; requirement: { code: string; name: string } } }[]; assignments: CatalogAssignment[] }[] }) {
  return { id: course.id, code: course.code, title: course.title, description: course.description, category: course.category, versions: course.versions.map(version => ({ id: version.id, versionNumber: version.versionNumber, status: version.status, estimatedDurationMinutes: version.estimatedDurationMinutes, requirements: version.trainingOptions.map(option => ({ id: option.complianceRequirementVersion.id, code: option.complianceRequirementVersion.requirement.code, name: option.complianceRequirementVersion.requirement.name })), ...assignmentState(version.assignments) })) };
}

async function baselineCatalog(organizationId: string, employeeId: string, at = new Date()) {
  const registry = await registryContext(organizationId, at), requirementIds = registry.requirementVersions.map(row => row.id);
  if (!requirementIds.length) return { registry, courses: [] };
  const courses = await prisma.trainingCourse.findMany({ where: { status: "ACTIVE", OR: [{ organizationId: null }, { organizationId }], versions: { some: { status: { in: ["PUBLISHED", "ACTIVE"] }, effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }], trainingOptions: { some: { complianceRequirementVersionId: { in: requirementIds } } } } } }, include: { versions: { where: { status: { in: ["PUBLISHED", "ACTIVE"] }, effectiveFrom: { lte: at }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }], trainingOptions: { some: { complianceRequirementVersionId: { in: requirementIds } } } }, include: { trainingOptions: { where: { complianceRequirementVersionId: { in: requirementIds } }, include: { complianceRequirementVersion: { include: { requirement: true } } } }, assignments: { where: { organizationId, employeeId, status: { in: [...activeAssignmentStatuses] } }, include: { completion: { select: { id: true } } }, orderBy: { assignedAt: "desc" } } } } }, orderBy: [{ code: "asc" }, { title: "asc" }] });
  return { registry, courses: courses.map(courseProjection) };
}

async function personSpecificCatalog(organizationId: string, employeeId: string, at = new Date()) {
  const assignments = await prisma.serviceAssignment.findMany({ where: { organizationId, employeeId, serviceRecipientRef: { not: null }, status: { in: ["PROPOSED", "BLOCKED", "ACTIVE"] }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gte: at } }] }, include: { duties: true }, orderBy: { startsAt: "desc" } });
  if (!assignments.length) return [];
  const rules = await prisma.serviceAssignmentRequirementRule.findMany({ where: { organizationId, status: "ACTIVE", OR: [{ requirementVersionId: { not: null } }, { medicationPathwayId: { not: null } }] }, include: { requirementVersion: { include: { requirement: true, trainingOptions: { where: { isDefault: true }, include: { trainingCourseVersion: { include: { course: true, assignments: { where: { organizationId, employeeId, status: { in: [...activeAssignmentStatuses] } }, include: { completion: { select: { id: true } } }, orderBy: { assignedAt: "desc" } } } } } } } }, medicationPathway: { include: { courseVersion: { include: { course: true, assignments: { where: { organizationId, employeeId, status: { in: [...activeAssignmentStatuses] } }, include: { completion: { select: { id: true } } }, orderBy: { assignedAt: "desc" } } } } } } } });
  const refs = [...new Set(assignments.flatMap(row => row.serviceRecipientRef ? [row.serviceRecipientRef] : []))], clients = await prisma.client.findMany({ where: { organizationId, id: { in: refs } }, select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true } }), names = new Map(clients.map(row => [row.id, row.preferredName || `${row.legalFirstName} ${row.legalLastName}`]));
  return assignments.map(assignment => {
    const dutyIds = new Set(assignment.duties.map(row => row.dutyDefinitionId));
    const matched = rules.filter(rule => (!rule.programId || rule.programId === assignment.programId) && (!rule.locationId || rule.locationId === assignment.locationId) && (!rule.serviceRecipientRef || rule.serviceRecipientRef === assignment.serviceRecipientRef) && (!rule.dutyDefinitionId || dutyIds.has(rule.dutyDefinitionId)));
    return { serviceAssignmentId: assignment.id, serviceRecipientRef: assignment.serviceRecipientRef!, personName: names.get(assignment.serviceRecipientRef!) ?? "Assigned person", blockingScope: assignment.blockingScope, assignmentStatus: assignment.status, requirements: matched.map(rule => { const option = rule.requirementVersion?.trainingOptions[0], version = option?.trainingCourseVersion ?? rule.medicationPathway?.courseVersion ?? null; return { ruleId: rule.id, ruleName: rule.name, requirementVersionId: rule.requirementVersionId, requirementCode: rule.requirementVersion?.requirement.code ?? null, requirementName: rule.requirementVersion?.requirement.name ?? (rule.medicationPathway ? "Governed medication qualification pathway" : null), medicationPathwayId: rule.medicationPathwayId, course: version ? { id: version.course.id, code: version.course.code, title: version.course.title, courseVersionId: version.id, versionNumber: version.versionNumber, ...assignmentState(version.assignments) } : null }; }) };
  });
}

export async function getEmployeeTrainingReadiness(user: Pick<User, "id">, organizationId: string, employeeId: string, at = new Date()) {
  await authorize(user, organizationId, employeeId);
  const [{ registry, courses }, personSpecific, readiness, pathways, qualifications] = await Promise.all([
    baselineCatalog(organizationId, employeeId, at),
    personSpecificCatalog(organizationId, employeeId, at),
    prisma.employeeWorkforceReadiness.findUnique({ where: { employeeId }, include: { firstAidEvidence: true, medicationEvidence: true } }),
    prisma.medicationQualificationPathway.findMany({ where: { organizationId }, include: { requirementVersion: { include: { requirement: true } }, courseVersion: { include: { course: true, assignments: { where: { organizationId, employeeId, status: { in: [...activeAssignmentStatuses] } }, include: { completion: { select: { id: true } } }, orderBy: { assignedAt: "desc" } } } } } }),
    prisma.medicationQualification.findMany({ where: { organizationId, employeeId, status: "ACTIVE", decision: "APPROVED" }, select: { courseVersionId: true } }),
  ]);
  const qualifiedCourseVersions = new Set(qualifications.map(row => row.courseVersionId));
  const firstAidRequirement = registry.requirementVersions.find(row => row.requirement.code === "245D-WF-012");
  return {
    employeeId,
    generatedAt: at.toISOString(),
    baseline: { licenseTypes: registry.licenseTypes, courses, meaning: courses.length ? "Registry-mapped workforce training available from the organization’s active program/license configuration. Assignment does not require a client relationship." : "No active registry-mapped baseline catalog is available for this organization configuration." },
    firstAid: { status: readiness?.firstAidStatus ?? "NOT_RECORDED", evidence: readiness?.firstAidEvidence ? { id: readiness.firstAidEvidence.id, providerName: readiness.firstAidEvidence.providerName, trainingName: readiness.firstAidEvidence.trainingName, trainingDate: readiness.firstAidEvidence.trainingDate, expiresAt: readiness.firstAidEvidence.expiresAt, reviewStatus: readiness.firstAidEvidence.reviewStatus } : null, requirement: firstAidRequirement ? { id: firstAidRequirement.id, code: firstAidRequirement.requirement.code, name: firstAidRequirement.requirement.name } : null, meaning: "Submitted evidence remains unverified until authorized review and a mapped equivalency decision; internal course completion is not an external certification." },
    medication: { status: readiness?.medicationStatus ?? "NOT_RECORDED", evidence: readiness?.medicationEvidence ? { id: readiness.medicationEvidence.id, providerName: readiness.medicationEvidence.providerName, trainingName: readiness.medicationEvidence.trainingName, trainingDate: readiness.medicationEvidence.trainingDate, expiresAt: readiness.medicationEvidence.expiresAt, reviewStatus: readiness.medicationEvidence.reviewStatus } : null, pathways: pathways.map(pathway => ({ id: pathway.id, requirementCode: pathway.requirementVersion.requirement.code, title: pathway.courseVersion.course.title, courseVersionId: pathway.courseVersionId, assignment: assignmentState(pathway.courseVersion.assignments), qualificationState: qualifiedCourseVersions.has(pathway.courseVersionId) ? "QUALIFIED" : "NOT_QUALIFIED" })), meaning: "Training, external evidence, observed competency, clinical approval, person-specific instruction, and medication authorization remain separate." },
    personSpecific: { assignments: personSpecific, meaning: personSpecific.length ? "Requirements are derived from configured service-assignment rules and the employee’s assigned person/responsibilities." : "No person-specific service assignments currently establish training requirements." },
  };
}

export async function assignBaselineTraining(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  await authorize(user, organizationId, employeeId, "training.assignment.manage");
  const ids = [...new Set(z.object({ courseVersionIds: z.array(z.string().cuid()).min(1).max(50) }).strict().parse(raw).courseVersionIds)], catalog = await baselineCatalog(organizationId, employeeId), allowed = new Set(catalog.courses.flatMap(course => course.versions.map(version => version.id)));
  if (ids.some(id => !allowed.has(id))) throw new AuthorizationError("Select only current registry-mapped baseline course versions");
  const assignments = await Promise.all(ids.map(courseVersionId => createManualAssignment(user, organizationId, { employeeId, courseVersionId })));
  return { assignments, readiness: await getEmployeeTrainingReadiness(user, organizationId, employeeId) };
}

export async function updateFirstAidReadiness(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  await authorize(user, organizationId, employeeId, "training.assignment.manage");
  const input = z.discriminatedUnion("choice", [z.object({ choice: z.literal("ALREADY_HAVE"), evidence: evidenceInput }), z.object({ choice: z.literal("NEEDS_TRAINING") })]).parse(raw);
  let evidenceRecordId: string | null = null, assignmentId: string | null = null;
  if (input.choice === "ALREADY_HAVE") evidenceRecordId = (await createExternalTrainingForEmployee(user, organizationId, employeeId, input.evidence)).id;
  else {
    const registry = await registryContext(organizationId), applicable = registry.requirementVersions.find(row => row.requirement.code === "245D-WF-012");
    if (!applicable) throw new ValidationError("No applicable First Aid requirement is available for this organization configuration");
    const requirement = await prisma.complianceRequirementVersion.findUnique({ where: { id: applicable.id }, include: { trainingOptions: { where: { isDefault: true, trainingCourseVersion: { status: { in: ["PUBLISHED", "ACTIVE"] }, course: { status: "ACTIVE", OR: [{ organizationId: null }, { organizationId }] } } }, orderBy: { createdAt: "asc" } } } });
    const option = requirement?.trainingOptions[0];
    if (!option) throw new ValidationError("No current registry-mapped First Aid training is available");
    assignmentId = (await createManualAssignment(user, organizationId, { employeeId, courseVersionId: option.trainingCourseVersionId })).id;
  }
  await prisma.$transaction([prisma.employeeWorkforceReadiness.upsert({ where: { employeeId }, create: { organizationId, employeeId, firstAidStatus: input.choice === "ALREADY_HAVE" ? "EVIDENCE_SUBMITTED" : "NEEDS_TRAINING", firstAidEvidenceRecordId: evidenceRecordId, updatedByUserId: user.id }, update: { firstAidStatus: input.choice === "ALREADY_HAVE" ? "EVIDENCE_SUBMITTED" : "NEEDS_TRAINING", firstAidEvidenceRecordId: evidenceRecordId, updatedByUserId: user.id } }), prisma.auditEvent.create({ data: { organizationId, employeeId, actorUserId: user.id, eventType: "workforce.readiness.first_aid_updated", entityType: "Employee", entityId: employeeId, metadataJson: { choice: input.choice, evidenceRecordId, assignmentId } } })]);
  return getEmployeeTrainingReadiness(user, organizationId, employeeId);
}

export async function updateMedicationReadiness(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  await authorize(user, organizationId, employeeId, "training.assignment.manage");
  const input = z.discriminatedUnion("choice", [z.object({ choice: z.literal("ALREADY_HAVE"), evidence: evidenceInput }), z.object({ choice: z.literal("NEEDS_TRAINING") }), z.object({ choice: z.literal("NOT_CURRENTLY_APPLICABLE") })]).parse(raw);
  let evidenceRecordId: string | null = null; const assignmentIds: string[] = [];
  if (input.choice === "ALREADY_HAVE") evidenceRecordId = (await createExternalTrainingForEmployee(user, organizationId, employeeId, input.evidence)).id;
  if (input.choice === "NEEDS_TRAINING") {
    const pathways = await prisma.medicationQualificationPathway.findMany({ where: { organizationId }, select: { id: true } });
    if (!pathways.length) throw new ValidationError("No governed medication training pathway is configured for this organization");
    for (const pathway of pathways) assignmentIds.push((await assignMedicationTraining(user, organizationId, employeeId, pathway.id)).id);
  }
  const status = input.choice === "ALREADY_HAVE" ? "EVIDENCE_SUBMITTED" : input.choice;
  await prisma.$transaction([prisma.employeeWorkforceReadiness.upsert({ where: { employeeId }, create: { organizationId, employeeId, medicationStatus: status, medicationEvidenceRecordId: evidenceRecordId, updatedByUserId: user.id }, update: { medicationStatus: status, medicationEvidenceRecordId: evidenceRecordId, updatedByUserId: user.id } }), prisma.auditEvent.create({ data: { organizationId, employeeId, actorUserId: user.id, eventType: "workforce.readiness.medication_updated", entityType: "Employee", entityId: employeeId, metadataJson: { choice: input.choice, evidenceRecordId, assignmentIds } } })]);
  return getEmployeeTrainingReadiness(user, organizationId, employeeId);
}

export async function initializePersonSpecificTraining(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  await authorize(user, organizationId, employeeId, "training.assignment.manage");
  const input = z.object({ serviceAssignmentIds: z.array(z.string().cuid()).min(1).max(50) }).strict().parse(raw), projection = await personSpecificCatalog(organizationId, employeeId), selected = projection.filter(row => input.serviceAssignmentIds.includes(row.serviceAssignmentId));
  if (selected.length !== new Set(input.serviceAssignmentIds).size) throw new ResourceNotFoundError("One or more person-specific assignments are unavailable");
  const created: { complianceInstanceId: string; assignmentId: string | null }[] = [];
  for (const service of selected) for (const requirement of service.requirements) {
    if (!requirement.requirementVersionId) continue;
    const rulesetLink = await prisma.complianceRulesetRequirement.findFirst({ where: { requirementVersionId: requirement.requirementVersionId, ruleset: { status: "ACTIVE" } }, include: { ruleset: true }, orderBy: { ruleset: { version: "desc" } } });
    if (!rulesetLink) throw new ValidationError(`No active registry ruleset contains ${requirement.requirementCode ?? "the configured person-specific requirement"}`);
    const requiredAt = new Date(), fingerprint = `person-specific:${employeeId}:${service.serviceAssignmentId}:${requirement.requirementVersionId}`;
    const instance = await prisma.complianceInstance.upsert({ where: { fingerprint }, create: { fingerprint, organizationId, employeeId, requirementVersionId: requirement.requirementVersionId, triggerType: "DUTY_ASSIGNED", triggerReference: service.serviceAssignmentId, requiredAt, hardBlockAt: requiredAt, status: "ASSIGNED", lastEvaluatedAt: requiredAt, rulesetId: rulesetLink.rulesetId }, update: { lastEvaluatedAt: requiredAt } });
    const assignment = await assignTrainingForCompliance(instance.id); created.push({ complianceInstanceId: instance.id, assignmentId: assignment?.id ?? null });
  }
  await prisma.auditEvent.create({ data: { organizationId, employeeId, actorUserId: user.id, eventType: "workforce.person_specific_training_initialized", entityType: "Employee", entityId: employeeId, metadataJson: { serviceAssignmentIds: input.serviceAssignmentIds, requirementCount: created.length } } });
  return { created, readiness: await getEmployeeTrainingReadiness(user, organizationId, employeeId) };
}
