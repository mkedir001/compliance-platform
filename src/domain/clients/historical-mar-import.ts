import { Prisma, type HistoricalMarMatchState as DbHistoricalMarMatchState, type HistoricalMarReconstructionState, type HistoricalMedicationAuthorizationState, type MedicationDoseStatus, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { requireOrganizationAccess, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { loadAxisCareConfig } from "@/domain/axiscare/config";
import { newClient, upsertVisit } from "@/domain/axiscare/sync";
import { dateToDayKey, dayKeyToDate, isDayKey, todayKey } from "./mar";
import { AXISCARE_API_VERSION } from "@/domain/axiscare/client";
import { HISTORICAL_MAR_ALGORITHM_VERSION, HISTORICAL_MAR_OCCURRENCE_KEY_VERSION, buildMedicationOccurrences, matchHistoricalOccurrenceWithSupplemental, reconcileSupplementalAttendance, stableHistoricalHash, type HistoricalVisit, type MedicationVersion, type ReconciledSupplementalAttendance } from "./historical-mar-matching";
import { inspectPavilioWorkbookBase64, type PavilioWorkbookInspection } from "./pavilio-attendance";

const day = z.string().refine(isDayKey, "Use a real date (YYYY-MM-DD)");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time (HH:mm)");
const doseStatus = z.enum(["GIVEN", "REFUSED", "HELD", "NOT_GIVEN"]);
const workbook = z.object({ fileName: z.string().trim().min(1).max(255).regex(/\.xlsx$/i, "Use an XLSX workbook"), workbookBase64: z.string().min(4).max(7_000_000), confirmedClientId: z.string().min(1).max(100), confirmClient: z.literal(true) });
const employeeMappings = z.array(z.object({ sourceEmployeeId: z.string().trim().min(1).max(100), employeeId: z.string().min(1).max(100).nullable() }).strict()).min(1).max(100);
export const HISTORICAL_MAR_ATTESTATION_VERSION = "historical-paper-mar-reviewer-v2";
export const HISTORICAL_MAR_ATTESTATION_STATEMENT = "I personally compared the selected historical MAR entries with the identified authoritative source records and confirm that the transcribed outcomes accurately reflect those records. I did not personally observe the administrations unless separately documented, and attendance evidence alone does not prove medication administration.";

export const historicalMarAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PREVIEW_HISTORICAL_MAR"), rangeStart: day, rangeEnd: day }).strict(),
  z.object({ action: z.literal("STAGE_HISTORICAL_MAR"), rangeStart: day, rangeEnd: day, expectedFingerprint: z.string().length(64) }).strict(),
  workbook.extend({ action: z.literal("INSPECT_PAVILIO_ATTENDANCE") }).strict(),
  workbook.extend({ action: z.literal("PREVIEW_PAVILIO_HISTORICAL_MAR"), employeeMappings }).strict(),
  workbook.extend({ action: z.literal("STAGE_PAVILIO_HISTORICAL_MAR"), employeeMappings, expectedFingerprint: z.string().length(64) }).strict(),
  z.object({ action: z.literal("REVIEW_HISTORICAL_MAR_ENTRY"), entryId: z.string().cuid(), expectedVersion: z.number().int().positive(), personallyCompared: z.literal(true), paperStatus: doseStatus, paperTimeGiven: time.nullish(), paperNote: z.string().trim().max(1000).nullish(), sourceReference: z.string().trim().max(300).nullish(), sourceDescription: z.string().trim().max(1000).nullish(), sourceCaregiverSigned: z.boolean().nullish(), discrepancyCode: z.string().trim().max(100).nullish(), discrepancyNote: z.string().trim().max(1000).nullish(), correctionReason: z.string().trim().min(10).max(500).nullish() }).strict(),
  z.object({ action: z.literal("FLAG_HISTORICAL_MAR_ENTRY"), entryId: z.string().cuid(), expectedVersion: z.number().int().positive(), discrepancyCode: z.string().trim().min(1).max(100), discrepancyNote: z.string().trim().min(10).max(1000), sourceReference: z.string().trim().max(300).nullish() }).strict(),
  z.object({ action: z.literal("ATTEST_HISTORICAL_MAR_ENTRIES"), batchId: z.string().cuid(), entryIds: z.array(z.string().cuid()).min(1).max(500), rangeStart: day.optional(), rangeEnd: day.optional(), consent: z.literal(true) }).strict(),
]);
export type HistoricalMarAction = z.infer<typeof historicalMarAction>;

export function historicalMarAllowlist() {
  return new Set((process.env.HISTORICAL_MAR_ORGANIZATION_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));
}
export function requireHistoricalMarEnabled(organizationId: string) {
  if (!historicalMarAllowlist().has(organizationId)) throw new AuthorizationError("Historical MAR import is not enabled for this organization");
}

export async function hasHistoricalMarReviewAccess(userId: string, organizationId: string, clientId: string) {
  if (!historicalMarAllowlist().has(organizationId)) return false;
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { id: true, status: true } });
  if (membership?.status === "ACTIVE") {
    const permissions = await resolvePermissionCodes(membership.id);
    if (["historical_mar.reconstruct", "historical_mar.review", "historical_mar.correct", "historical_mar.attest"].some(code => permissions.has(code))) return true;
  }
  return Boolean(await prisma.historicalMarEntry.findFirst({ where: { organizationId, clientId, employee: { userId, employmentStatus: "ACTIVE" } }, select: { id: true } }));
}

function validateRange(rangeStart: string, rangeEnd: string, timeZone: string) {
  if (rangeStart > rangeEnd) throw new ValidationError("The start date must not be after the end date");
  if (rangeEnd > todayKey(new Date(), timeZone)) throw new ValidationError("Historical MAR import cannot include a future date");
  const days = Math.floor((dayKeyToDate(rangeEnd).getTime() - dayKeyToDate(rangeStart).getTime()) / 86_400_000) + 1;
  if (days > 366) throw new ValidationError("Historical MAR import is limited to 12 months");
  return days;
}

async function requireHistoricalPermission(user: Pick<User, "id">, organizationId: string, permission: "historical_mar.reconstruct" | "historical_mar.review" | "historical_mar.correct" | "historical_mar.attest") {
  requireHistoricalMarEnabled(organizationId);
  const { organization, membership } = await requireOrganizationAccess(user, organizationId);
  const permissions = await resolvePermissionCodes(membership.id);
  if (!permissions.has(permission)) throw new AuthorizationError(`Missing permission: ${permission}`);
  return { organization, membership, permissions };
}

async function refreshAxisCareRange(organizationId: string, rangeStart: string, rangeEnd: string) {
  const config = await loadAxisCareConfig(organizationId);
  if (!config) throw new ValidationError("AxisCare must be configured before historical MAR import");
  let count = 0;
  for await (const page of newClient(config).list("/api/visits", "visits", { startDate: rangeStart, endDate: rangeEnd, limit: 100 })) {
    for (const raw of page) if (await upsertVisit(organizationId, raw)) count += 1;
  }
  return count;
}

type MedicationRow = Awaited<ReturnType<typeof prisma.clientMedication.findMany>>[number];
type HistoryRow = Awaited<ReturnType<typeof prisma.clientMedicationHistory.findMany>>[number];
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" ? value : null;
const bool = (value: unknown) => value === true;

function versionFrom(value: unknown, medicationId: string, source: string): MedicationVersion | null {
  const row = object(value); if (!row) return null;
  const medication = text(row.medication); if (!medication) return null;
  const date = (raw: unknown) => { const value = text(raw); return value ? value.slice(0, 10) : null; };
  const approvedAt = bool(row.marApprovedAt) ? date(row.marApprovedAt) : Boolean(text(row.marApprovedAt)) && Boolean(text(row.marApprovedByUserId)) ? date(row.marApprovedAt) : null;
  return { medicationId, medication, dose: text(row.dose), route: text(row.route), times: text(row.times), startDate: date(row.startDate), stopDate: date(row.stopDate), approvedAt, historicalApprovedFrom: date(row.historicalApprovedFrom), historicalApprovedThrough: date(row.historicalApprovedThrough), source };
}

function medicationVersions(medications: MedicationRow[], histories: HistoryRow[]) {
  const versions: MedicationVersion[] = medications.map(row => ({ medicationId: row.id, medication: row.medication, dose: row.dose, route: row.route, times: row.times, startDate: row.startDate ? dateToDayKey(row.startDate) : null, stopDate: row.stopDate ? dateToDayKey(row.stopDate) : null, approvedAt: row.marApprovedAt && row.marApprovedByUserId ? dateToDayKey(row.marApprovedAt) : null, historicalApprovedFrom: row.historicalApprovedFrom ? dateToDayKey(row.historicalApprovedFrom) : null, historicalApprovedThrough: row.historicalApprovedThrough ? dateToDayKey(row.historicalApprovedThrough) : null, source: "current" }));
  for (const history of histories) {
    const snapshot = object(history.snapshotJson);
    for (const side of ["before", "after"] as const) {
      const version = versionFrom(snapshot?.[side], history.entityId, `history:${history.id}:${side}`);
      if (version) versions.push(version);
    }
  }
  const distinct = new Map<string, MedicationVersion>();
  for (const version of versions) distinct.set(JSON.stringify(version), version);
  return [...distinct.values()];
}

type SupplementalPreview = {
  workbookHash: string;
  fileName: string;
  rows: ReconciledSupplementalAttendance[];
  rowProvenance: Map<string, { rowNumber: number; sourceEmployeeId: string; localClockIn: string; localClockOut: string; visitStatus: string; evvSource: string; manualEvv: boolean }>;
  rowErrors: { rowNumber: number; code: string }[];
  errorCounts: Record<string, number>;
  reconciliationCounts: Record<string, number>;
};

async function buildPreview(organizationId: string, clientId: string, rangeStart: string, rangeEnd: string, timeZone: string, supplemental?: SupplementalPreview, ignoreBatchId?: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true, axisCareClientId: true } });
  if (!client) throw new ResourceNotFoundError("Client not found");
  validateRange(rangeStart, rangeEnd, timeZone);
  const low = new Date(dayKeyToDate(rangeStart).getTime() - 86_400_000), high = new Date(dayKeyToDate(rangeEnd).getTime() + 2 * 86_400_000);
  const [medications, histories, visits, existing, existingHistorical] = await Promise.all([
    prisma.clientMedication.findMany({ where: { organizationId, clientId } }),
    prisma.clientMedicationHistory.findMany({ where: { organizationId, clientId, entityType: "MEDICATION" }, orderBy: { changedAt: "asc" } }),
    prisma.axisCareVisit.findMany({ where: { organizationId, clientId, OR: [{ clockInAt: { gte: low, lt: high } }, { scheduledStartAt: { gte: low, lt: high } }, { startAt: { gte: low, lt: high } }] }, orderBy: { startAt: "asc" } }),
    prisma.clientMedicationDose.findMany({ where: { organizationId, clientId, doseDate: { gte: dayKeyToDate(rangeStart), lte: dayKeyToDate(rangeEnd) } }, select: { medicationId: true, doseDate: true, scheduledTime: true } }),
    prisma.historicalMarEntry.findMany({ where: { organizationId, clientId, ...(ignoreBatchId ? { batchId: { not: ignoreBatchId } } : {}), doseDate: { gte: dayKeyToDate(rangeStart), lte: dayKeyToDate(rangeEnd) } }, select: { medicationId: true, doseDate: true, scheduledTime: true } }),
  ]);
  const visitRows: HistoricalVisit[] = visits.map(row => ({ id: row.id, externalId: row.externalId, employeeId: row.employeeId, axisCareCaregiverId: row.axisCareCaregiverId, clockInAt: row.clockInAt, clockOutAt: row.clockOutAt, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt, removed: row.removed, modificationReason: row.modificationReason }));
  const existingKeys = new Set([...existing, ...existingHistorical].map(row => `${row.medicationId}|${dateToDayKey(row.doseDate)}|${row.scheduledTime}`));
  const occurrences = buildMedicationOccurrences(medicationVersions(medications, histories), rangeStart, rangeEnd);
  const proposals = occurrences.map(occurrence => {
    const slotKey = `${occurrence.medicationId}|${occurrence.day}|${occurrence.scheduledTime}`;
    const match = matchHistoricalOccurrenceWithSupplemental(occurrence.day, occurrence.scheduledTime, timeZone, visitRows, supplemental?.rows ?? []);
    const matchState = existingKeys.has(slotKey) ? "EXISTING_MAR_ENTRY" : occurrence.scheduleState === "MEDICATION_HISTORY_GAP" ? "MEDICATION_HISTORY_GAP" : match.state;
    const medicationAuthorizationState = occurrence.scheduleState === "APPROVED" ? "APPROVED" : occurrence.scheduleState === "MEDICATION_HISTORY_GAP" ? "HISTORY_UNRESOLVED" : "UNAPPROVED_DRAFT";
    const pavilio = match.attendanceEvidenceKey ? supplemental?.rowProvenance.get(match.attendanceEvidenceKey) ?? null : null;
    const source = { algorithmVersion: HISTORICAL_MAR_ALGORITHM_VERSION, attendanceSource: match.attendanceSource, attendanceEvidenceKey: match.attendanceEvidenceKey, axisCareVisitId: match.visitId, axisCareExternalVisitIds: match.candidates, pavilioEvidence: pavilio ? { workbookHash: supplemental!.workbookHash, rowHash: match.attendanceEvidenceKey, ...pavilio } : null, supplementalCandidates: match.supplementalCandidates, confidence: match.confidence, scheduleSources: occurrence.scheduleSources, occurrence: { day: occurrence.day, scheduledTime: occurrence.scheduledTime }, medication: { id: occurrence.medicationId, name: occurrence.medication, dose: occurrence.dose, route: occurrence.route } };
    return { ...occurrence, matchState, medicationAuthorizationState: medicationAuthorizationState as HistoricalMedicationAuthorizationState, reconstructionState: (match.attendanceEvidenceKey || match.visitId ? "RECONSTRUCTED" : "SCHEDULED") as HistoricalMarReconstructionState, confidence: match.confidence, attendanceSource: match.attendanceSource ?? "UNRESOLVED", attendanceEvidenceKey: match.attendanceEvidenceKey, axisCareVisitId: match.visitId, employeeId: match.employeeId, source, stableSourceKey: stableHistoricalHash({ organizationId, clientId, medicationId: occurrence.medicationId, day: occurrence.day, scheduledTime: occurrence.scheduledTime, algorithm: HISTORICAL_MAR_OCCURRENCE_KEY_VERSION }) };
  });
  const counts = proposals.reduce<Record<string, number>>((summary, row) => { summary[row.matchState] = (summary[row.matchState] ?? 0) + 1; return summary; }, {});
  const sourceQuery = { endpoint: "GET /api/visits", apiVersion: AXISCARE_API_VERSION, startDate: rangeStart, endDate: rangeEnd, pagination: "results.nextPage", limit: 100, clientLink: client.axisCareClientId ? "CONFIRMED" : "MISSING", supplemental: supplemental ? { provider: "PAVILIO", fileName: supplemental.fileName, workbookHash: supplemental.workbookHash, rows: supplemental.rows.map(row => ({ rowHash: row.rowHash, rowNumber: row.rowNumber, reconciliationState: row.reconciliationState, axisCareVisitIds: row.axisCareVisitIds })).sort((a, b) => a.rowNumber - b.rowNumber), errors: supplemental.rowErrors, errorCounts: supplemental.errorCounts, reconciliationCounts: supplemental.reconciliationCounts } : null };
  const readyForSourceReview = proposals.filter(proposal => proposal.medicationAuthorizationState === "APPROVED" && !["EXISTING_MAR_ENTRY", "MEDICATION_HISTORY_GAP"].includes(proposal.matchState)).length;
  const fingerprint = stableHistoricalHash({ organizationId, clientId, rangeStart, rangeEnd, algorithm: HISTORICAL_MAR_ALGORITHM_VERSION, proposals: proposals.map(proposal => ({ stableSourceKey: proposal.stableSourceKey, matchState: proposal.matchState, medicationAuthorizationState: proposal.medicationAuthorizationState, confidence: proposal.confidence, axisCareVisitId: proposal.axisCareVisitId, employeeId: proposal.employeeId, sourceHash: stableHistoricalHash(proposal.source) })) });
  return { fingerprint, sourceQuery, counts, total: proposals.length, readyForCaregiverReview: readyForSourceReview, readyForSourceReview, blocked: proposals.length - readyForSourceReview, proposals };
}

export async function previewHistoricalMarImport(user: Pick<User, "id">, organizationId: string, clientId: string, rangeStart: string, rangeEnd: string) {
  const { organization } = await requireHistoricalPermission(user, organizationId, "historical_mar.reconstruct");
  return buildPreview(organizationId, clientId, rangeStart, rangeEnd, organization.timezone);
}

type WorkbookInput = { fileName: string; workbookBase64: string; confirmedClientId: string; confirmClient: true };
type EmployeeMappingInput = { sourceEmployeeId: string; employeeId: string | null }[];

async function inspectConfirmedWorkbook(user: Pick<User, "id">, organizationId: string, clientId: string, input: WorkbookInput) {
  const { organization } = await requireHistoricalPermission(user, organizationId, "historical_mar.reconstruct");
  if (input.confirmedClientId !== clientId) throw new ValidationError("The selected client confirmation does not match this workspace");
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!client) throw new ResourceNotFoundError("Client not found");
  return { organization, inspection: await inspectPavilioWorkbookBase64(input.workbookBase64, organization.timezone) };
}

function errorCounts(inspection: PavilioWorkbookInspection) {
  return inspection.errors.reduce<Record<string, number>>((counts, row) => { counts[row.code] = (counts[row.code] ?? 0) + 1; return counts; }, {});
}

export async function inspectPavilioAttendance(user: Pick<User, "id">, organizationId: string, clientId: string, input: WorkbookInput) {
  const { inspection } = await inspectConfirmedWorkbook(user, organizationId, clientId, input);
  const employees = await prisma.employee.findMany({ where: { organizationId }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, employmentStatus: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return {
    workbookHash: inspection.workbookHash,
    sheets: inspection.sheetNames,
    columns: inspection.columns,
    totalRows: inspection.totalRows,
    usableRows: inspection.usableRows.length,
    errorCounts: errorCounts(inspection),
    errors: inspection.errors,
    dateCoverage: inspection.dateCoverage,
    sourceEmployees: inspection.sourceEmployees.map(source => ({ ...source, suggestedEmployeeId: employees.find(employee => employee.employeeNumber === source.sourceEmployeeId)?.id ?? null })),
    employees: employees.map(employee => ({ id: employee.id, employeeNumber: employee.employeeNumber, name: `${employee.firstName} ${employee.lastName}`, employmentStatus: employee.employmentStatus })),
  };
}

async function supplementalPreview(user: Pick<User, "id">, organizationId: string, clientId: string, input: WorkbookInput, mappings: EmployeeMappingInput, ignoreBatchId?: string) {
  const { organization, inspection } = await inspectConfirmedWorkbook(user, organizationId, clientId, input);
  if (!inspection.dateCoverage || !inspection.usableRows.length) throw new ValidationError("The workbook has no usable verified attendance rows");
  const unique = new Map(mappings.map(mapping => [mapping.sourceEmployeeId, mapping.employeeId]));
  if (unique.size !== mappings.length) throw new ValidationError("Each Pavilio employee identifier may be mapped only once");
  const required = new Set(inspection.sourceEmployees.map(employee => employee.sourceEmployeeId));
  if ([...required].some(id => !unique.has(id)) || [...unique].some(([id]) => !required.has(id))) throw new ValidationError("Every workbook employee identifier must have one explicit mapping");
  const employeeIds = [...new Set(mappings.map(mapping => mapping.employeeId).filter((id): id is string => Boolean(id)))];
  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, organizationId }, select: { id: true } });
  if (employees.length !== employeeIds.length) throw new ValidationError("Every mapped caregiver must belong to this organization");
  const rangeStart = inspection.dateCoverage.start, rangeEnd = inspection.dateCoverage.end;
  validateRange(rangeStart, rangeEnd, organization.timezone);
  const low = new Date(dayKeyToDate(rangeStart).getTime() - 86_400_000), high = new Date(dayKeyToDate(rangeEnd).getTime() + 2 * 86_400_000);
  const visits = await prisma.axisCareVisit.findMany({ where: { organizationId, clientId, OR: [{ clockInAt: { gte: low, lt: high } }, { scheduledStartAt: { gte: low, lt: high } }, { startAt: { gte: low, lt: high } }] }, orderBy: { startAt: "asc" } });
  const visitRows: HistoricalVisit[] = visits.map(row => ({ id: row.id, externalId: row.externalId, employeeId: row.employeeId, axisCareCaregiverId: row.axisCareCaregiverId, clockInAt: row.clockInAt, clockOutAt: row.clockOutAt, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt, removed: row.removed, modificationReason: row.modificationReason }));
  const mapped = inspection.usableRows.map(row => ({ rowHash: row.rowHash, rowNumber: row.rowNumber, employeeId: unique.get(row.sourceEmployeeId) ?? null, clockInAt: row.clockInAt, clockOutAt: row.clockOutAt }));
  const rows = reconcileSupplementalAttendance(visitRows, mapped);
  const reconciliationCounts = rows.reduce<Record<string, number>>((counts, row) => { counts[row.reconciliationState] = (counts[row.reconciliationState] ?? 0) + 1; return counts; }, {});
  const rowProvenance = new Map(inspection.usableRows.map(row => [row.rowHash, { rowNumber: row.rowNumber, sourceEmployeeId: row.sourceEmployeeId, localClockIn: row.localClockIn, localClockOut: row.localClockOut, visitStatus: row.visitStatus, evvSource: row.evvSource, manualEvv: row.manualEvv }]));
  const supplemental: SupplementalPreview = { workbookHash: inspection.workbookHash, fileName: input.fileName, rows, rowProvenance, rowErrors: inspection.errors.map(error => ({ rowNumber: error.rowNumber, code: error.code })), errorCounts: errorCounts(inspection), reconciliationCounts };
  const preview = await buildPreview(organizationId, clientId, rangeStart, rangeEnd, organization.timezone, supplemental, ignoreBatchId);
  return { ...preview, rangeStart, rangeEnd, workbook: { hash: inspection.workbookHash, totalRows: inspection.totalRows, usableRows: inspection.usableRows.length, errorCounts: supplemental.errorCounts, reconciliationCounts, dateCoverage: inspection.dateCoverage } };
}

export async function previewPavilioHistoricalMar(user: Pick<User, "id">, organizationId: string, clientId: string, input: WorkbookInput, mappings: EmployeeMappingInput) {
  return supplementalPreview(user, organizationId, clientId, input, mappings);
}

export async function stagePavilioHistoricalMar(user: Pick<User, "id">, organizationId: string, clientId: string, input: WorkbookInput, mappings: EmployeeMappingInput, expectedFingerprint: string, options: { refreshSource?: boolean } = {}) {
  const { organization } = await requireHistoricalPermission(user, organizationId, "historical_mar.reconstruct");
  if (input.confirmedClientId !== clientId) throw new ValidationError("The selected client confirmation does not match this workspace");
  const prior = await prisma.historicalMarImportBatch.findUnique({ where: { organizationId_sourceFingerprint: { organizationId, sourceFingerprint: expectedFingerprint } }, include: { entries: true } });
  if (prior?.clientId !== undefined && prior.clientId !== clientId) throw new ConflictError("This import fingerprint belongs to another client", "HISTORICAL_MAR_CLIENT_MISMATCH");
  const inspection = await inspectPavilioWorkbookBase64(input.workbookBase64, organization.timezone);
  if (!inspection.dateCoverage) throw new ValidationError("The workbook has no usable verified attendance rows");
  if (options.refreshSource !== false) await refreshAxisCareRange(organizationId, inspection.dateCoverage.start, inspection.dateCoverage.end);
  const preview = await supplementalPreview(user, organizationId, clientId, input, mappings, prior?.id);
  if (preview.fingerprint !== expectedFingerprint) throw new ConflictError("The historical import preview is stale. Review it again before staging.", "HISTORICAL_MAR_PREVIEW_STALE");
  if (prior) return { id: prior.id, status: prior.status, created: false, summary: prior.summaryJson };
  const batch = await prisma.$transaction(async tx => {
    const row = await tx.historicalMarImportBatch.create({ data: { organizationId, clientId, rangeStart: dayKeyToDate(preview.rangeStart), rangeEnd: dayKeyToDate(preview.rangeEnd), source: "AXISCARE_PAVILIO", sourceQueryJson: preview.sourceQuery as Prisma.InputJsonValue, sourceFingerprint: preview.fingerprint, summaryJson: { counts: preview.counts, total: preview.total, readyForCaregiverReview: preview.readyForCaregiverReview, blocked: preview.blocked, workbook: preview.workbook }, requestedByUserId: user.id } });
    if (preview.proposals.length) await tx.historicalMarEntry.createMany({ data: preview.proposals.map(proposal => ({ organizationId, clientId, batchId: row.id, medicationId: proposal.medicationId, axisCareVisitId: proposal.axisCareVisitId, attendanceSource: proposal.attendanceSource, attendanceEvidenceKey: proposal.attendanceEvidenceKey, employeeId: proposal.employeeId, doseDate: dayKeyToDate(proposal.day), scheduledTime: proposal.scheduledTime, stableSourceKey: proposal.stableSourceKey, matchState: proposal.matchState as DbHistoricalMarMatchState, confidence: proposal.confidence, sourceSnapshotJson: proposal.source as Prisma.InputJsonValue, reconstructionState: proposal.reconstructionState, medicationAuthorizationState: proposal.medicationAuthorizationState, medicationAuthorizationSnapshotJson: { scheduleState: proposal.scheduleState, scheduleSources: proposal.scheduleSources } })), skipDuplicates: true });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_pavilio_staged", entityType: "HistoricalMarImportBatch", entityId: row.id, metadataJson: { clientId, rangeStart: preview.rangeStart, rangeEnd: preview.rangeEnd, counts: preview.counts, workbookHash: preview.workbook.hash, usableAttendanceRows: preview.workbook.usableRows, reconciliationCounts: preview.workbook.reconciliationCounts, algorithmVersion: HISTORICAL_MAR_ALGORITHM_VERSION } } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { id: batch.id, status: batch.status, created: true, summary: batch.summaryJson };
}

export async function stageHistoricalMarImport(user: Pick<User, "id">, organizationId: string, clientId: string, rangeStart: string, rangeEnd: string, expectedFingerprint: string, options: { refreshSource?: boolean } = {}) {
  const { organization } = await requireHistoricalPermission(user, organizationId, "historical_mar.reconstruct");
  validateRange(rangeStart, rangeEnd, organization.timezone);
  const prior = await prisma.historicalMarImportBatch.findUnique({ where: { organizationId_sourceFingerprint: { organizationId, sourceFingerprint: expectedFingerprint } }, include: { entries: true } });
  if (prior?.clientId !== undefined && prior.clientId !== clientId) throw new ConflictError("This import fingerprint belongs to another client", "HISTORICAL_MAR_CLIENT_MISMATCH");
  if (options.refreshSource !== false) await refreshAxisCareRange(organizationId, rangeStart, rangeEnd);
  const preview = await buildPreview(organizationId, clientId, rangeStart, rangeEnd, organization.timezone, undefined, prior?.id);
  if (preview.fingerprint !== expectedFingerprint) throw new ConflictError("The historical import preview is stale. Review it again before staging.", "HISTORICAL_MAR_PREVIEW_STALE");
  if (prior) return { id: prior.id, status: prior.status, created: false, summary: prior.summaryJson };
  const batch = await prisma.$transaction(async tx => {
    const row = await tx.historicalMarImportBatch.create({ data: { organizationId, clientId, rangeStart: dayKeyToDate(rangeStart), rangeEnd: dayKeyToDate(rangeEnd), sourceQueryJson: preview.sourceQuery as Prisma.InputJsonValue, sourceFingerprint: preview.fingerprint, summaryJson: { counts: preview.counts, total: preview.total, readyForCaregiverReview: preview.readyForCaregiverReview, blocked: preview.blocked }, requestedByUserId: user.id } });
    if (preview.proposals.length) await tx.historicalMarEntry.createMany({ data: preview.proposals.map(proposal => ({ organizationId, clientId, batchId: row.id, medicationId: proposal.medicationId, axisCareVisitId: proposal.axisCareVisitId, attendanceSource: proposal.attendanceSource, attendanceEvidenceKey: proposal.attendanceEvidenceKey, employeeId: proposal.employeeId, doseDate: dayKeyToDate(proposal.day), scheduledTime: proposal.scheduledTime, stableSourceKey: proposal.stableSourceKey, matchState: proposal.matchState as DbHistoricalMarMatchState, confidence: proposal.confidence, sourceSnapshotJson: proposal.source as Prisma.InputJsonValue, reconstructionState: proposal.reconstructionState, medicationAuthorizationState: proposal.medicationAuthorizationState, medicationAuthorizationSnapshotJson: { scheduleState: proposal.scheduleState, scheduleSources: proposal.scheduleSources } })), skipDuplicates: true });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_staged", entityType: "HistoricalMarImportBatch", entityId: row.id, metadataJson: { clientId, rangeStart, rangeEnd, counts: preview.counts, algorithmVersion: HISTORICAL_MAR_ALGORITHM_VERSION } } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { id: batch.id, status: batch.status, created: true, summary: batch.summaryJson };
}

export async function reviewHistoricalMarEntry(user: Pick<User, "id">, organizationId: string, clientId: string, input: Extract<HistoricalMarAction, { action: "REVIEW_HISTORICAL_MAR_ENTRY" }>) {
  const { permissions } = await requireHistoricalPermission(user, organizationId, "historical_mar.review");
  const entry = await prisma.historicalMarEntry.findFirst({ where: { id: input.entryId, organizationId, clientId }, select: { id: true, employeeId: true, matchState: true, medicationAuthorizationState: true, reviewState: true, version: true, finalizedDoseId: true } });
  if (!entry) throw new ResourceNotFoundError("Historical MAR entry not found");
  if (entry.medicationAuthorizationState !== "APPROVED") throw new ValidationError("The historical medication schedule must be clinically authorized before source verification");
  if (entry.matchState === "EXISTING_MAR_ENTRY" || entry.matchState === "MEDICATION_HISTORY_GAP") throw new ValidationError("This entry has an unresolved medication or MAR conflict");
  if (entry.version !== input.expectedVersion) throw new ConflictError("This historical MAR entry changed after it was opened", "HISTORICAL_MAR_ENTRY_STALE");
  if (entry.reviewState === "ATTESTED" && (!permissions.has("historical_mar.correct") || !input.correctionReason)) throw new ValidationError("Historical correction permission and a correction reason are required to change an attested entry");
  if (input.paperStatus === "GIVEN" && !input.paperTimeGiven) throw new ValidationError("Time given is required for a given dose");
  if (input.paperStatus !== "GIVEN" && !input.paperNote) throw new ValidationError("A paper-MAR note is required for refused, held, or not-given doses");
  if (!input.sourceReference && !input.sourceDescription) throw new ValidationError("Identify the authoritative source record used for verification");
  const flagged = Boolean(input.discrepancyCode || input.discrepancyNote);
  const now = new Date();
  const result = await prisma.historicalMarEntry.updateMany({ where: { id: entry.id, version: entry.version }, data: { reconstructionState: "RECONSTRUCTED", paperStatus: input.paperStatus, paperTimeGiven: input.paperStatus === "GIVEN" ? input.paperTimeGiven : null, paperNote: input.paperNote ?? null, sourceReference: input.sourceReference ?? null, sourceDescription: input.sourceDescription ?? null, sourceCaregiverSigned: input.sourceCaregiverSigned ?? null, sourceVerifiedByUserId: flagged ? null : user.id, sourceVerifiedAt: flagged ? null : now, discrepancyCode: input.discrepancyCode ?? null, discrepancyNote: input.discrepancyNote ?? null, correctionReason: input.correctionReason ?? null, reviewedByUserId: user.id, reviewedAt: now, reviewState: flagged ? "FLAGGED_FOR_CORRECTION" : "SOURCE_VERIFIED", version: { increment: 1 } } });
  if (result.count !== 1) throw new ConflictError("This historical MAR entry changed concurrently", "HISTORICAL_MAR_ENTRY_STALE");
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: flagged ? "client.historical_mar_discrepancy_flagged" : entry.finalizedDoseId ? "client.historical_mar_correction_source_verified" : "client.historical_mar_source_verified", entityType: "HistoricalMarEntry", entityId: entry.id, metadataJson: { clientId, attributedEmployeeId: entry.employeeId, priorVersion: entry.version, sourceCaregiverSigned: input.sourceCaregiverSigned ?? null } } });
  return { ok: true, state: flagged ? "FLAGGED_FOR_CORRECTION" : "SOURCE_VERIFIED" };
}

export async function flagHistoricalMarEntry(user: Pick<User, "id">, organizationId: string, clientId: string, input: Extract<HistoricalMarAction, { action: "FLAG_HISTORICAL_MAR_ENTRY" }>) {
  await requireHistoricalPermission(user, organizationId, "historical_mar.review");
  const entry = await prisma.historicalMarEntry.findFirst({ where: { id: input.entryId, organizationId, clientId }, select: { id: true, version: true, employeeId: true } });
  if (!entry) throw new ResourceNotFoundError("Historical MAR entry not found");
  if (entry.version !== input.expectedVersion) throw new ConflictError("This historical MAR entry changed after it was opened", "HISTORICAL_MAR_ENTRY_STALE");
  const result = await prisma.historicalMarEntry.updateMany({ where: { id: entry.id, version: entry.version }, data: { reconstructionState: "RECONSTRUCTED", reviewState: "FLAGGED_FOR_CORRECTION", discrepancyCode: input.discrepancyCode, discrepancyNote: input.discrepancyNote, sourceReference: input.sourceReference ?? null, reviewedByUserId: user.id, reviewedAt: new Date(), sourceVerifiedByUserId: null, sourceVerifiedAt: null, version: { increment: 1 } } });
  if (result.count !== 1) throw new ConflictError("This historical MAR entry changed concurrently", "HISTORICAL_MAR_ENTRY_STALE");
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_unresolved_recorded", entityType: "HistoricalMarEntry", entityId: entry.id, metadataJson: { clientId, attributedEmployeeId: entry.employeeId, priorVersion: entry.version, discrepancyCode: input.discrepancyCode } } });
  return { ok: true, state: "FLAGGED_FOR_CORRECTION" };
}

export async function attestHistoricalMarEntries(user: Pick<User, "id">, organizationId: string, clientId: string, batchId: string, entryIds: string[], requestedRange?: { rangeStart?: string; rangeEnd?: string }) {
  const { membership } = await requireHistoricalPermission(user, organizationId, "historical_mar.attest");
  const uniqueIds = [...new Set(entryIds)].sort();
  if (uniqueIds.length !== entryIds.length) throw new ValidationError("Each historical MAR entry may be selected only once");
  const [signature, entries, batch, reviewerEmployee, membershipWithRoles] = await Promise.all([
    prisma.medicationStaffSignature.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } }),
    prisma.historicalMarEntry.findMany({ where: { id: { in: uniqueIds }, organizationId, clientId, batchId }, orderBy: { id: "asc" } }),
    prisma.historicalMarImportBatch.findFirst({ where: { id: batchId, organizationId, clientId } }),
    prisma.employee.findFirst({ where: { organizationId, userId: user.id }, select: { id: true } }),
    prisma.organizationMembership.findUnique({ where: { id: membership.id }, include: { roles: { include: { roleDefinition: { select: { code: true } } } } } }),
  ]);
  if (!signature) throw new ValidationError("Set up your medication signature before attesting");
  if (!batch) throw new ResourceNotFoundError("Historical MAR reconstruction period not found");
  if (entries.length !== uniqueIds.length) throw new ResourceNotFoundError("One or more historical MAR entries were not found");
  const rangeStart = requestedRange?.rangeStart ?? dateToDayKey(batch.rangeStart), rangeEnd = requestedRange?.rangeEnd ?? dateToDayKey(batch.rangeEnd);
  validateRange(rangeStart, rangeEnd, "UTC");
  for (const entry of entries) {
    const day = dateToDayKey(entry.doseDate);
    if (day < rangeStart || day > rangeEnd) throw new ValidationError("Every selected entry must be inside the signed date range");
    if (entry.reviewState !== "SOURCE_VERIFIED" || !entry.sourceVerifiedByUserId || !entry.sourceVerifiedAt || !entry.paperStatus) throw new ValidationError("Every selected entry must be source-verified and ready to attest");
    if (entry.medicationAuthorizationState !== "APPROVED") throw new ValidationError("Unapproved medication schedules cannot be attested as administrations");
  }
  const reviewerRole = membershipWithRoles?.roles.map(role => role.roleDefinition.code).sort().join(",") || "MEMBERSHIP_PERMISSION_REVIEWER";
  const snapshot = entries.map(entry => ({ id: entry.id, version: entry.version, medicationId: entry.medicationId, doseDate: dateToDayKey(entry.doseDate), scheduledTime: entry.scheduledTime, status: entry.paperStatus, timeGiven: entry.paperTimeGiven, note: entry.paperNote, sourceReference: entry.sourceReference, sourceDescription: entry.sourceDescription, sourceCaregiverSigned: entry.sourceCaregiverSigned, sourceVerifiedByUserId: entry.sourceVerifiedByUserId, sourceVerifiedAt: entry.sourceVerifiedAt?.toISOString(), attributedEmployeeId: entry.employeeId, attendanceSource: entry.attendanceSource, attendanceEvidenceKey: entry.attendanceEvidenceKey, axisCareVisitId: entry.axisCareVisitId, confidence: entry.confidence, correctionReason: entry.correctionReason, priorAttestationId: entry.attestationId }));
  const snapshotHash = stableHistoricalHash({ organizationId, clientId, rangeStart, rangeEnd, reviewerUserId: user.id, reviewerRole, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION, entries: snapshot });
  const attestation = await prisma.$transaction(async tx => {
    const current = await tx.historicalMarEntry.findMany({ where: { id: { in: uniqueIds } }, orderBy: { id: "asc" } });
    if (current.some((entry, index) => entry.version !== entries[index].version || entry.reviewState !== "SOURCE_VERIFIED")) throw new ConflictError("A selected entry changed before signature", "HISTORICAL_MAR_ATTESTATION_STALE");
    const signed = await tx.historicalMarAttestation.create({ data: { organizationId, clientId, batchId, employeeId: reviewerEmployee?.id ?? null, signerUserId: user.id, reviewerRole, rangeStart: dayKeyToDate(rangeStart), rangeEnd: dayKeyToDate(rangeEnd), medicationSignatureId: signature.id, entryIdsJson: uniqueIds, snapshotJson: snapshot as Prisma.InputJsonValue, snapshotHash, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION, statementSnapshot: HISTORICAL_MAR_ATTESTATION_STATEMENT } });
    for (const entry of current) {
      const data = { status: entry.paperStatus as MedicationDoseStatus, timeGiven: entry.paperStatus === "GIVEN" ? entry.paperTimeGiven : null, note: entry.paperNote, signerUserId: user.id, signerName: signature.typedName, signerInitials: signature.initials, appliedByUserId: user.id, attestedInPerson: false, transferredFromPaper: true, signedAt: signed.signedAt, correctionReason: entry.correctionReason ?? "Historical paper MAR verified electronically" };
      let doseId = entry.finalizedDoseId;
      if (doseId) {
        const before = await tx.clientMedicationDose.findUniqueOrThrow({ where: { id: doseId } });
        const updated = await tx.clientMedicationDose.update({ where: { id: doseId }, data });
        await tx.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "DOSE", entityId: doseId, action: "HISTORICAL_CORRECTED_AND_REATTESTED", changedByUserId: user.id, snapshotJson: { before, after: updated, attestationId: signed.id, correctionReason: entry.correctionReason } as unknown as Prisma.InputJsonValue } });
      } else {
        const occupied = await tx.clientMedicationDose.findUnique({ where: { medicationId_doseDate_scheduledTime: { medicationId: entry.medicationId, doseDate: entry.doseDate, scheduledTime: entry.scheduledTime } }, select: { id: true } });
        if (occupied) throw new ConflictError("An existing MAR entry occupies one of the selected historical slots", "HISTORICAL_MAR_SLOT_OCCUPIED");
        const dose = await tx.clientMedicationDose.create({ data: { organizationId, clientId, medicationId: entry.medicationId, doseDate: entry.doseDate, scheduledTime: entry.scheduledTime, ...data } });
        doseId = dose.id;
        await tx.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "DOSE", entityId: dose.id, action: "HISTORICAL_ATTESTED", changedByUserId: user.id, snapshotJson: { after: dose, attestationId: signed.id, sourceSnapshot: entry.sourceSnapshotJson } as unknown as Prisma.InputJsonValue } });
      }
      await tx.historicalMarEntry.update({ where: { id: entry.id }, data: { attestationId: signed.id, finalizedDoseId: doseId, reviewState: "ATTESTED", correctionReason: null } });
    }
    const remaining = await tx.historicalMarEntry.count({ where: { batchId, reviewState: { in: ["AWAITING_CAREGIVER_REVIEW", "READY_TO_ATTEST", "SOURCE_VERIFIED"] } } });
    const exceptions = await tx.historicalMarEntry.count({ where: { batchId, OR: [{ matchState: { not: "MATCHED" } }, { reviewState: "FLAGGED_FOR_CORRECTION" }] } });
    await tx.historicalMarImportBatch.update({ where: { id: batchId }, data: { status: remaining ? "IN_REVIEW" : exceptions ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED" } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_attested", entityType: "HistoricalMarAttestation", entityId: signed.id, metadataJson: { clientId, rangeStart, rangeEnd, reviewerRole, entryCount: uniqueIds.length, snapshotHash, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION } } });
    return signed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ok: true, attestationId: attestation.id, entryCount: uniqueIds.length, signedAt: attestation.signedAt.toISOString() };
}

export async function getHistoricalMarWorkspace(userId: string, organizationId: string, clientId: string, canAdmin: boolean) {
  const enabled = historicalMarAllowlist().has(organizationId);
  if (!enabled) return { enabled: false, canImport: false, canReconstruct: false, canReview: false, canCorrect: false, canAttest: false, completeness: [], entries: [], batches: [], statement: HISTORICAL_MAR_ATTESTATION_STATEMENT };
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { id: true, status: true } });
  const permissions = membership?.status === "ACTIVE" ? await resolvePermissionCodes(membership.id) : new Set<string>();
  const access = { canReconstruct: permissions.has("historical_mar.reconstruct"), canReview: permissions.has("historical_mar.review"), canCorrect: permissions.has("historical_mar.correct"), canAttest: permissions.has("historical_mar.attest") };
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId }, select: { id: true } });
  const privileged = canAdmin || Object.values(access).some(Boolean);
  const entries = privileged || employee ? await prisma.historicalMarEntry.findMany({ where: { organizationId, clientId, ...(privileged ? {} : { employeeId: employee!.id }) }, include: { medication: { select: { medication: true, dose: true, route: true } }, employee: { select: { id: true, firstName: true, lastName: true, employmentStatus: true } }, axisCareVisit: { select: { externalId: true, clockInAt: true, clockOutAt: true } }, attestation: { select: { signedAt: true, snapshotHash: true } } }, orderBy: [{ doseDate: "asc" }, { scheduledTime: "asc" }] }) : [];
  const batches = privileged ? await prisma.historicalMarImportBatch.findMany({ where: { organizationId, clientId }, select: { id: true, rangeStart: true, rangeEnd: true, status: true, summaryJson: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  const completeness = batches.map(batch => {
    const rows = entries.filter(entry => entry.batchId === batch.id);
    return { batchId: batch.id, rangeStart: dateToDayKey(batch.rangeStart), rangeEnd: dateToDayKey(batch.rangeEnd), expectedScheduledOccurrences: rows.length, draftOccurrences: rows.filter(row => row.reconstructionState === "SCHEDULED").length, awaitingSourceReview: rows.filter(row => ["AWAITING_CAREGIVER_REVIEW", "READY_TO_ATTEST"].includes(row.reviewState)).length, verifiedEntries: rows.filter(row => ["SOURCE_VERIFIED", "ATTESTED"].includes(row.reviewState)).length, attestedEntries: rows.filter(row => row.reviewState === "ATTESTED").length, missingAttendance: rows.filter(row => ["NO_ACTUAL_VISIT", "MISSING_CLOCK_IN", "MISSING_CLOCK_OUT"].includes(row.matchState)).length, unresolvedCaregiverIdentities: rows.filter(row => !row.employeeId || row.matchState === "MISSING_CAREGIVER_MAPPING").length, conflictingAttendance: rows.filter(row => row.matchState === "AMBIGUOUS_VISIT").length, missingMedicationAuthorization: rows.filter(row => row.medicationAuthorizationState !== "APPROVED").length, unresolvedAdministrationOutcomes: rows.filter(row => !row.paperStatus || row.reviewState === "FLAGGED_FOR_CORRECTION").length, complete: rows.length > 0 && rows.every(row => row.reviewState === "ATTESTED") };
  });
  return { enabled: true, canImport: access.canReconstruct, ...access, statement: HISTORICAL_MAR_ATTESTATION_STATEMENT, completeness, batches: batches.map(batch => ({ ...batch, rangeStart: dateToDayKey(batch.rangeStart), rangeEnd: dateToDayKey(batch.rangeEnd), createdAt: batch.createdAt.toISOString() })), entries: entries.map(entry => ({ id: entry.id, batchId: entry.batchId, medication: entry.medication, employee: entry.employee ? { id: entry.employee.id, name: `${entry.employee.firstName} ${entry.employee.lastName}`, employmentStatus: entry.employee.employmentStatus } : null, mine: Boolean(employee && entry.employeeId === employee.id), doseDate: dateToDayKey(entry.doseDate), scheduledTime: entry.scheduledTime, reconstructionState: entry.reconstructionState, medicationAuthorizationState: entry.medicationAuthorizationState, matchState: entry.matchState, confidence: entry.confidence, attendanceSource: entry.attendanceSource, attendanceEvidenceKey: entry.attendanceEvidenceKey, reviewState: entry.reviewState, paperStatus: entry.paperStatus, paperTimeGiven: entry.paperTimeGiven, paperNote: entry.paperNote, sourceReference: entry.sourceReference, sourceDescription: entry.sourceDescription, sourceCaregiverSigned: entry.sourceCaregiverSigned, sourceVerifiedAt: entry.sourceVerifiedAt?.toISOString() ?? null, discrepancyCode: entry.discrepancyCode, discrepancyNote: entry.discrepancyNote, correctionReason: entry.correctionReason, version: entry.version, visit: entry.axisCareVisit ? { externalId: entry.axisCareVisit.externalId, clockInAt: entry.axisCareVisit.clockInAt?.toISOString() ?? null, clockOutAt: entry.axisCareVisit.clockOutAt?.toISOString() ?? null } : null, attestation: entry.attestation ? { signedAt: entry.attestation.signedAt.toISOString(), snapshotHash: entry.attestation.snapshotHash } : null })) };
}

export async function applyHistoricalMarAction(user: Pick<User, "id">, organizationId: string, clientId: string, raw: unknown) {
  const input = historicalMarAction.parse(raw);
  if (input.action === "PREVIEW_HISTORICAL_MAR") return previewHistoricalMarImport(user, organizationId, clientId, input.rangeStart, input.rangeEnd);
  if (input.action === "STAGE_HISTORICAL_MAR") return stageHistoricalMarImport(user, organizationId, clientId, input.rangeStart, input.rangeEnd, input.expectedFingerprint);
  if (input.action === "INSPECT_PAVILIO_ATTENDANCE") return inspectPavilioAttendance(user, organizationId, clientId, input);
  if (input.action === "PREVIEW_PAVILIO_HISTORICAL_MAR") return previewPavilioHistoricalMar(user, organizationId, clientId, input, input.employeeMappings);
  if (input.action === "STAGE_PAVILIO_HISTORICAL_MAR") return stagePavilioHistoricalMar(user, organizationId, clientId, input, input.employeeMappings, input.expectedFingerprint);
  if (input.action === "REVIEW_HISTORICAL_MAR_ENTRY") return reviewHistoricalMarEntry(user, organizationId, clientId, input);
  if (input.action === "FLAG_HISTORICAL_MAR_ENTRY") return flagHistoricalMarEntry(user, organizationId, clientId, input);
  return attestHistoricalMarEntries(user, organizationId, clientId, input.batchId, input.entryIds, input);
}
