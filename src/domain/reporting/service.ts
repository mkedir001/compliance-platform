import { Prisma, type EmploymentStatus, type User } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { getEmployeeAuditRecord } from "@/domain/audit/service";
import { deriveTemporalStatus } from "@/domain/compliance/operations/deadlines";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export const REPORT_VERSION = "phase22-v1";
export const MAX_REPORT_PAGE_SIZE = 100;
export const MAX_CSV_ROWS = 1000;
type Page = { page?: number; pageSize?: number };
type Dates = { from?: Date; to?: Date };

async function authorize(user: Pick<User, "id">, organizationId: string, permission: "audit.read" | "audit.export" = "audit.read") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
  return { membership, permissions: await resolvePermissionCodes(membership.id) };
}

function paging(input: Page, exportMode = false) {
  const maximum = exportMode ? MAX_CSV_ROWS : MAX_REPORT_PAGE_SIZE;
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(maximum, Math.floor(input.pageSize ?? 25)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { reportVersion: REPORT_VERSION, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), items };
}

export async function getOrganizationComplianceReport(user: Pick<User, "id">, organizationId: string, input: { workforceStatus?: EmploymentStatus; at?: Date } = {}) {
  await authorize(user, organizationId);
  const at = input.at ?? new Date(), workforceStatus = input.workforceStatus ?? "ACTIVE";
  const employees = await prisma.employee.findMany({ where: { organizationId, employmentStatus: workforceStatus }, select: { id: true, complianceInstances: { where: { status: { not: "SUPERSEDED" } }, select: { status: true } } }, take: 5000 });
  if (employees.length === 5000) throw new AuthorizationError("Organization report exceeds 5,000 employees; narrow the workforce status scope");
  const employeeIds = employees.map(item => item.id), actionStatuses = ["REQUIRED", "PAST_DUE", "BLOCKED"] as const;
  const [trainingExceptions, policyExceptions, credentialExceptions, competencyExceptions, evidenceReviewExceptions, remediation, assignmentBlockers, readiness] = await Promise.all([
    prisma.trainingAssignment.count({ where: { organizationId, employeeId: { in: employeeIds }, status: { in: ["NOT_STARTED", "IN_PROGRESS", "TRAINING_COMPLETE_COMPETENCY_PENDING", "FAILED"] } } }),
    prisma.policyAssignment.count({ where: { organizationId, employeeId: { in: employeeIds }, status: { in: ["PENDING", "OVERDUE"] } } }),
    prisma.professionalCredential.count({ where: { organizationId, employeeId: { in: employeeIds }, status: "ACTIVE", OR: [{ verificationStatus: { not: "VERIFIED" } }, { expiresAt: { lt: at } }] } }),
    prisma.competencyAssessment.count({ where: { organizationId, employeeId: { in: employeeIds }, OR: [{ status: { in: ["DRAFT", "IN_PROGRESS"] } }, { result: { in: ["FAIL", "REMEDIATION_REQUIRED"] } }] } }),
    prisma.externalTrainingRecord.count({ where: { organizationId, employeeId: { in: employeeIds }, reviewStatus: { in: ["PENDING", "NEEDS_MORE_INFORMATION", "DENIED"] } } }),
    prisma.complianceIssue.count({ where: { organizationId, employeeId: { in: employeeIds }, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.serviceAssignment.count({ where: { organizationId, employeeId: { in: employeeIds }, status: "BLOCKED" } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, timezone: true, licenses: { where: { licenseStatus: { not: "ARCHIVED" } }, select: { licenseType: true, licenseStatus: true } }, _count: { select: { programs: true, locations: true } } } }),
  ]);
  const current = employees.filter(item => item.complianceInstances.length > 0 && item.complianceInstances.every(instance => ["SATISFIED", "WAIVED_BY_EQUIVALENCY"].includes(instance.status))).length;
  const requiringAction = employees.filter(item => item.complianceInstances.some(instance => (actionStatuses as readonly string[]).includes(instance.status))).length;
  return { reportVersion: REPORT_VERSION, asOf: at.toISOString(), workforceScope: workforceStatus, totalApplicableWorkforce: employees.length, currentEmployees: current, employeesRequiringAction: requiringAction, measurementDefinition: "Current employees are workers in the selected workforce scope with at least one applicable non-superseded compliance instance and every such instance recorded as SATISFIED or WAIVED_BY_EQUIVALENCY.", exceptions: { training: trainingExceptions, policyAcknowledgment: policyExceptions, credential: credentialExceptions, competency: competencyExceptions, evidenceReview: evidenceReviewExceptions, activeRemediation: remediation, serviceAssignmentBlockers: assignmentBlockers }, organizationReadiness: readiness, disclaimer: "This report reflects platform records and is not regulatory approval, audit passage, or legal certification." };
}

export async function getEmployeeComplianceReport(user: Pick<User, "id">, organizationId: string, employeeId: string, at?: Date) {
  const { permissions } = await authorize(user, organizationId);
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.read");
  const record = await getEmployeeAuditRecord(user, organizationId, employeeId, at ? { mode: "POINT_IN_TIME", at } : { mode: "CURRENT" });
  if (!permissions.has("clinical.review")) record.medicationGovernance = { access: "REDACTED", reason: "clinical.review permission required" } as never;
  return { ...record, reportVersion: REPORT_VERSION, historicalMeaning: at ? "Evidence and append-only events are bounded by the requested date. Mutable fields are explicitly labeled and are not presented as exact historical reconstruction." : "Current derived state with historical records kept distinct." };
}

export async function getTrainingReport(user: Pick<User, "id">, organizationId: string, input: Page & Dates & { employeeId?: string; courseId?: string; status?: string; at?: Date; exportMode?: boolean } = {}) {
  await authorize(user, organizationId); const { page, pageSize, skip } = paging(input, input.exportMode); const at = input.at ?? new Date();
  const where: Prisma.TrainingAssignmentWhereInput = { organizationId, employeeId: input.employeeId, courseVersion: input.courseId ? { courseId: input.courseId } : undefined, status: input.status as never, assignedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined };
  const [organization, total, rows] = await Promise.all([prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } }), prisma.trainingAssignment.count({ where }), prisma.trainingAssignment.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } }, courseVersion: { include: { course: { select: { id: true, code: true, title: true } } } }, completion: true }, orderBy: [{ assignedAt: "desc" }, { id: "asc" }], skip, take: pageSize })]);
  return pageResult(rows.map(row => ({ id: row.id, employee: row.employee, course: row.courseVersion.course, courseVersionId: row.courseVersionId, courseVersion: row.courseVersion.versionNumber, status: row.status, assignedAt: row.assignedAt, dueAt: row.dueAt, deadlineState: row.dueAt ? deriveTemporalStatus({ dueAt: row.dueAt, evaluatedAt: at, timeZone: organization.timezone }) : "NO_DEADLINE", completion: row.completion ? { id: row.completion.id, completedAt: row.completion.completedAt, method: row.completion.completionMethod } : null })), total, page, pageSize);
}

export async function getPolicyReport(user: Pick<User, "id">, organizationId: string, input: Page & Dates & { employeeId?: string; policyId?: string; status?: string; exportMode?: boolean } = {}) {
  await authorize(user, organizationId); const { page, pageSize, skip } = paging(input, input.exportMode);
  const where: Prisma.PolicyAssignmentWhereInput = { organizationId, employeeId: input.employeeId, policyVersion: input.policyId ? { policyId: input.policyId } : undefined, status: input.status as never, assignedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined };
  const [total, items] = await Promise.all([prisma.policyAssignment.count({ where }), prisma.policyAssignment.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } }, policyVersion: { include: { policy: true } }, attestation: { select: { id: true, signedAt: true, statementVersion: true, signatureHash: true } } }, orderBy: [{ assignedAt: "desc" }, { id: "asc" }], skip, take: pageSize })]);
  return pageResult(items.map(item => ({ id: item.id, employee: item.employee, policy: { id: item.policyVersion.policy.id, code: item.policyVersion.policy.code, title: item.policyVersion.policy.title }, policyVersionId: item.policyVersionId, versionNumber: item.policyVersion.versionNumber, versionStatus: item.policyVersion.status, assignedAt: item.assignedAt, dueAt: item.dueAt, status: item.status, acknowledgedAt: item.acknowledgedAt, attestation: item.attestation })), total, page, pageSize);
}

export async function getEvidenceReport(user: Pick<User, "id">, organizationId: string, input: Page & { employeeId?: string; exportMode?: boolean } = {}) {
  await authorize(user, organizationId); const { page, pageSize, skip } = paging(input, input.exportMode), employee = input.employeeId ? { id: input.employeeId } : undefined;
  const [credentials, competency, external, corrections] = await Promise.all([
    prisma.professionalCredential.findMany({ where: { organizationId, employee }, include: { employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take: pageSize }),
    prisma.competencyAssessment.findMany({ where: { organizationId, employeeId: input.employeeId }, include: { employee: { select: { id: true, firstName: true, lastName: true } }, competencyDefinition: true, skillChecklistVersion: true }, orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: pageSize }),
    prisma.externalTrainingRecord.findMany({ where: { organizationId, employeeId: input.employeeId }, include: { employee: { select: { id: true, firstName: true, lastName: true } }, equivalencyDecisions: { orderBy: { decidedAt: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: pageSize }),
    prisma.evidenceCorrection.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: pageSize }),
  ]);
  return { reportVersion: REPORT_VERSION, page, pageSize, credentials, competency, externalTraining: external, corrections, verificationNotice: "Uploaded or pending evidence is not verified unless its authoritative verification/review state explicitly says so." };
}

export async function getRemediationReport(user: Pick<User, "id">, organizationId: string, input: Page & Dates & { employeeId?: string; status?: "OPEN" | "IN_PROGRESS" | "RESOLVED"; exportMode?: boolean } = {}) {
  await authorize(user, organizationId); const { page, pageSize, skip } = paging(input, input.exportMode), where: Prisma.ComplianceIssueWhereInput = { organizationId, employeeId: input.employeeId, status: input.status, firstDetectedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined };
  const [total, items] = await Promise.all([prisma.complianceIssue.count({ where }), prisma.complianceIssue.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } }, events: { orderBy: { createdAt: "asc" } } }, orderBy: [{ firstDetectedAt: "desc" }, { id: "asc" }], skip, take: pageSize })]);
  return pageResult(items, total, page, pageSize);
}

export async function getServiceAssignmentReadinessReport(user: Pick<User, "id">, organizationId: string, input: Page & { employeeId?: string; status?: string; exportMode?: boolean } = {}) {
  const { permissions } = await authorize(user, organizationId); const { page, pageSize, skip } = paging(input, input.exportMode), where: Prisma.ServiceAssignmentWhereInput = { organizationId, employeeId: input.employeeId, status: input.status as never };
  const [total, rows] = await Promise.all([prisma.serviceAssignment.count({ where }), prisma.serviceAssignment.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } }, program: true, location: true, duties: { include: { dutyDefinition: true } }, eligibilityEvaluations: { orderBy: { evaluatedAt: "desc" }, take: 1 } }, orderBy: [{ startsAt: "desc" }, { id: "asc" }], skip, take: pageSize })]);
  const clinical = permissions.has("clinical.review");
  return pageResult(rows.map(row => { const evaluation = row.eligibilityEvaluations[0], medication = row.blockingScope === "MEDICATION_ADMINISTRATION" || row.duties.some(item => item.dutyDefinition.code === "MEDICATION_ADMINISTRATION"); return { id: row.id, employee: row.employee, program: row.program?.name ?? null, location: row.location?.name ?? null, blockingScope: medication && !clinical ? "CLINICAL_RESTRICTED" : row.blockingScope, status: row.status, readiness: evaluation?.decision ?? (row.status === "BLOCKED" ? "BLOCKED" : "NOT_EVALUATED"), reasonCodes: medication && !clinical ? ["CLINICAL_DETAIL_REDACTED"] : ((evaluation?.resultSnapshot as { reasonCodes?: string[] } | null)?.reasonCodes ?? []), evaluatedAt: evaluation?.evaluatedAt ?? null, disclaimer: "Specific assignment readiness only; not a general legal qualification claim." }; }), total, page, pageSize);
}

function csvCell(value: unknown) { const raw = value instanceof Date ? value.toISOString() : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; }
export function rowsToCsv(rows: Record<string, unknown>[]) { const keys = [...new Set(rows.flatMap(row => Object.keys(row)))]; return [keys.map(csvCell).join(","), ...rows.map(row => keys.map(key => csvCell(row[key])).join(","))].join("\r\n"); }

export async function listAuditPackages(user: Pick<User, "id">, organizationId: string, input: Page = {}) {
  await authorize(user, organizationId); const { page, pageSize, skip } = paging(input), where = { organizationId };
  const [total, items] = await Promise.all([prisma.auditPackage.count({ where }), prisma.auditPackage.findMany({ where, select: { id: true, scope: true, subjectType: true, subjectId: true, pointInTimeAt: true, rangeFrom: true, rangeTo: true, includedDomains: true, reportVersion: true, recordCount: true, status: true, requestedAt: true, generatedAt: true, integrityDigest: true }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], skip, take: pageSize })]);
  return pageResult(items, total, page, pageSize);
}
