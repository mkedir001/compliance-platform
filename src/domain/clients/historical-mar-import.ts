import { Prisma, type HistoricalMarMatchState as DbHistoricalMarMatchState, type MedicationDoseStatus, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { requireOrganizationAccess, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { loadAxisCareConfig } from "@/domain/axiscare/config";
import { newClient, upsertVisit } from "@/domain/axiscare/sync";
import { dateToDayKey, dayKeyToDate, isDayKey, todayKey } from "./mar";
import { AXISCARE_API_VERSION } from "@/domain/axiscare/client";
import { HISTORICAL_MAR_ALGORITHM_VERSION, buildMedicationOccurrences, matchHistoricalOccurrence, stableHistoricalHash, type HistoricalVisit, type MedicationVersion } from "./historical-mar-matching";

const day = z.string().refine(isDayKey, "Use a real date (YYYY-MM-DD)");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time (HH:mm)");
const doseStatus = z.enum(["GIVEN", "REFUSED", "HELD", "NOT_GIVEN"]);
export const HISTORICAL_MAR_ATTESTATION_VERSION = "historical-paper-mar-caregiver-v1";
export const HISTORICAL_MAR_ATTESTATION_STATEMENT = "I reviewed the identified historical paper MAR entries and confirm that the administration values recorded here accurately reflect that paper record. I understand that AxisCare visit evidence supports caregiver attribution but does not itself prove medication administration.";

export const historicalMarAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PREVIEW_HISTORICAL_MAR"), rangeStart: day, rangeEnd: day }).strict(),
  z.object({ action: z.literal("STAGE_HISTORICAL_MAR"), rangeStart: day, rangeEnd: day, expectedFingerprint: z.string().length(64) }).strict(),
  z.object({ action: z.literal("REVIEW_HISTORICAL_MAR_ENTRY"), entryId: z.string().cuid(), expectedVersion: z.number().int().positive(), paperStatus: doseStatus, paperTimeGiven: time.nullish(), paperNote: z.string().trim().max(1000).nullish(), discrepancyCode: z.string().trim().max(100).nullish(), discrepancyNote: z.string().trim().max(1000).nullish(), correctionReason: z.string().trim().min(10).max(500).nullish() }).strict(),
  z.object({ action: z.literal("ATTEST_HISTORICAL_MAR_ENTRIES"), batchId: z.string().cuid(), entryIds: z.array(z.string().cuid()).min(1).max(500), consent: z.literal(true) }).strict(),
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
  return Boolean(await prisma.historicalMarEntry.findFirst({ where: { organizationId, clientId, employee: { userId, employmentStatus: "ACTIVE" } }, select: { id: true } }));
}

function validateRange(rangeStart: string, rangeEnd: string, timeZone: string) {
  if (rangeStart > rangeEnd) throw new ValidationError("The start date must not be after the end date");
  if (rangeEnd > todayKey(new Date(), timeZone)) throw new ValidationError("Historical MAR import cannot include a future date");
  const days = Math.floor((dayKeyToDate(rangeEnd).getTime() - dayKeyToDate(rangeStart).getTime()) / 86_400_000) + 1;
  if (days > 366) throw new ValidationError("Historical MAR import is limited to 12 months");
  return days;
}

async function requireImportAdmin(user: Pick<User, "id">, organizationId: string) {
  requireHistoricalMarEnabled(organizationId);
  const { organization, membership } = await requireOrganizationAccess(user, organizationId);
  const permissions = await resolvePermissionCodes(membership.id);
  if (!permissions.has("medication.approve")) throw new AuthorizationError("Missing permission: medication.approve");
  const credential = await prisma.professionalCredential.findFirst({ where: { organizationId, userId: user.id, status: "ACTIVE", verificationStatus: "VERIFIED", credentialType: { in: ["RN", "CNS", "CNP", "PA", "PHYSICIAN"] }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }, select: { id: true } });
  if (!credential) throw new AuthorizationError("A current verified clinical credential is required for historical MAR import");
  return organization;
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
  return { medicationId, medication, dose: text(row.dose), route: text(row.route), times: text(row.times), startDate: date(row.startDate), stopDate: date(row.stopDate), approved: bool(row.marApprovedAt) || Boolean(text(row.marApprovedAt)) && Boolean(text(row.marApprovedByUserId)), source };
}

function medicationVersions(medications: MedicationRow[], histories: HistoryRow[]) {
  const versions: MedicationVersion[] = medications.map(row => ({ medicationId: row.id, medication: row.medication, dose: row.dose, route: row.route, times: row.times, startDate: row.startDate ? dateToDayKey(row.startDate) : null, stopDate: row.stopDate ? dateToDayKey(row.stopDate) : null, approved: Boolean(row.marApprovedAt && row.marApprovedByUserId), source: "current" }));
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

async function buildPreview(organizationId: string, clientId: string, rangeStart: string, rangeEnd: string, timeZone: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true, axisCareClientId: true } });
  if (!client) throw new ResourceNotFoundError("Client not found");
  validateRange(rangeStart, rangeEnd, timeZone);
  const low = new Date(dayKeyToDate(rangeStart).getTime() - 86_400_000), high = new Date(dayKeyToDate(rangeEnd).getTime() + 2 * 86_400_000);
  const [medications, histories, visits, existing] = await Promise.all([
    prisma.clientMedication.findMany({ where: { organizationId, clientId } }),
    prisma.clientMedicationHistory.findMany({ where: { organizationId, clientId, entityType: "MEDICATION" }, orderBy: { changedAt: "asc" } }),
    prisma.axisCareVisit.findMany({ where: { organizationId, clientId, OR: [{ clockInAt: { gte: low, lt: high } }, { scheduledStartAt: { gte: low, lt: high } }, { startAt: { gte: low, lt: high } }] }, orderBy: { startAt: "asc" } }),
    prisma.clientMedicationDose.findMany({ where: { organizationId, clientId, doseDate: { gte: dayKeyToDate(rangeStart), lte: dayKeyToDate(rangeEnd) } }, select: { medicationId: true, doseDate: true, scheduledTime: true } }),
  ]);
  const visitRows: HistoricalVisit[] = visits.map(row => ({ id: row.id, externalId: row.externalId, employeeId: row.employeeId, axisCareCaregiverId: row.axisCareCaregiverId, clockInAt: row.clockInAt, clockOutAt: row.clockOutAt, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt, removed: row.removed, modificationReason: row.modificationReason }));
  const existingKeys = new Set(existing.map(row => `${row.medicationId}|${dateToDayKey(row.doseDate)}|${row.scheduledTime}`));
  const occurrences = buildMedicationOccurrences(medicationVersions(medications, histories), rangeStart, rangeEnd);
  const proposals = occurrences.map(occurrence => {
    const slotKey = `${occurrence.medicationId}|${occurrence.day}|${occurrence.scheduledTime}`;
    const match = matchHistoricalOccurrence(occurrence.day, occurrence.scheduledTime, timeZone, visitRows);
    const matchState = existingKeys.has(slotKey) ? "EXISTING_MAR_ENTRY" : occurrence.scheduleState === "MEDICATION_HISTORY_GAP" ? "MEDICATION_HISTORY_GAP" : occurrence.scheduleState === "MEDICATION_NOT_APPROVED" ? "MEDICATION_NOT_APPROVED" : match.state;
    const source = { algorithmVersion: HISTORICAL_MAR_ALGORITHM_VERSION, axisCareVisitId: match.visitId, axisCareExternalVisitIds: match.candidates, confidence: match.confidence, scheduleSources: occurrence.scheduleSources, occurrence: { day: occurrence.day, scheduledTime: occurrence.scheduledTime }, medication: { id: occurrence.medicationId, name: occurrence.medication, dose: occurrence.dose, route: occurrence.route } };
    return { ...occurrence, matchState, confidence: match.confidence, axisCareVisitId: match.visitId, employeeId: matchState === "MATCHED" ? match.employeeId : null, source, stableSourceKey: stableHistoricalHash({ organizationId, clientId, medicationId: occurrence.medicationId, day: occurrence.day, scheduledTime: occurrence.scheduledTime, algorithm: HISTORICAL_MAR_ALGORITHM_VERSION }) };
  });
  const counts = proposals.reduce<Record<string, number>>((summary, row) => { summary[row.matchState] = (summary[row.matchState] ?? 0) + 1; return summary; }, {});
  const sourceQuery = { endpoint: "GET /api/visits", apiVersion: AXISCARE_API_VERSION, startDate: rangeStart, endDate: rangeEnd, pagination: "results.nextPage", limit: 100, clientLink: client.axisCareClientId ? "CONFIRMED" : "MISSING" };
  const fingerprint = stableHistoricalHash({ organizationId, clientId, rangeStart, rangeEnd, algorithm: HISTORICAL_MAR_ALGORITHM_VERSION, proposals: proposals.map(proposal => ({ stableSourceKey: proposal.stableSourceKey, matchState: proposal.matchState, confidence: proposal.confidence, axisCareVisitId: proposal.axisCareVisitId, employeeId: proposal.employeeId, sourceHash: stableHistoricalHash(proposal.source) })) });
  return { fingerprint, sourceQuery, counts, total: proposals.length, readyForCaregiverReview: counts.MATCHED ?? 0, blocked: proposals.length - (counts.MATCHED ?? 0), proposals };
}

export async function previewHistoricalMarImport(user: Pick<User, "id">, organizationId: string, clientId: string, rangeStart: string, rangeEnd: string) {
  const organization = await requireImportAdmin(user, organizationId);
  return buildPreview(organizationId, clientId, rangeStart, rangeEnd, organization.timezone);
}

export async function stageHistoricalMarImport(user: Pick<User, "id">, organizationId: string, clientId: string, rangeStart: string, rangeEnd: string, expectedFingerprint: string, options: { refreshSource?: boolean } = {}) {
  const organization = await requireImportAdmin(user, organizationId);
  validateRange(rangeStart, rangeEnd, organization.timezone);
  if (options.refreshSource !== false) await refreshAxisCareRange(organizationId, rangeStart, rangeEnd);
  const preview = await buildPreview(organizationId, clientId, rangeStart, rangeEnd, organization.timezone);
  if (preview.fingerprint !== expectedFingerprint) throw new ConflictError("The historical import preview is stale. Review it again before staging.", "HISTORICAL_MAR_PREVIEW_STALE");
  const existing = await prisma.historicalMarImportBatch.findUnique({ where: { organizationId_sourceFingerprint: { organizationId, sourceFingerprint: preview.fingerprint } }, include: { entries: true } });
  if (existing) return { id: existing.id, status: existing.status, created: false, summary: existing.summaryJson };
  const batch = await prisma.$transaction(async tx => {
    const row = await tx.historicalMarImportBatch.create({ data: { organizationId, clientId, rangeStart: dayKeyToDate(rangeStart), rangeEnd: dayKeyToDate(rangeEnd), sourceQueryJson: preview.sourceQuery as Prisma.InputJsonValue, sourceFingerprint: preview.fingerprint, summaryJson: { counts: preview.counts, total: preview.total, readyForCaregiverReview: preview.readyForCaregiverReview, blocked: preview.blocked }, requestedByUserId: user.id } });
    if (preview.proposals.length) await tx.historicalMarEntry.createMany({ data: preview.proposals.map(proposal => ({ organizationId, clientId, batchId: row.id, medicationId: proposal.medicationId, axisCareVisitId: proposal.axisCareVisitId, employeeId: proposal.employeeId, doseDate: dayKeyToDate(proposal.day), scheduledTime: proposal.scheduledTime, stableSourceKey: proposal.stableSourceKey, matchState: proposal.matchState as DbHistoricalMarMatchState, confidence: proposal.confidence, sourceSnapshotJson: proposal.source as Prisma.InputJsonValue })), skipDuplicates: true });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_staged", entityType: "HistoricalMarImportBatch", entityId: row.id, metadataJson: { clientId, rangeStart, rangeEnd, counts: preview.counts, algorithmVersion: HISTORICAL_MAR_ALGORITHM_VERSION } } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { id: batch.id, status: batch.status, created: true, summary: batch.summaryJson };
}

async function selfEmployee(userId: string, organizationId: string) {
  const { membership } = await requireOrganizationAccess({ id: userId }, organizationId);
  const permissions = await resolvePermissionCodes(membership.id);
  if (!permissions.has("medication.assigned.read") && !permissions.has("medication.activity.record")) throw new AuthorizationError("Missing assigned-client medication permission");
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId, employmentStatus: "ACTIVE" }, select: { id: true } });
  if (!employee) throw new AuthorizationError("An active employee identity is required");
  return employee;
}

export async function reviewHistoricalMarEntry(user: Pick<User, "id">, organizationId: string, clientId: string, input: Extract<HistoricalMarAction, { action: "REVIEW_HISTORICAL_MAR_ENTRY" }>) {
  requireHistoricalMarEnabled(organizationId);
  const employee = await selfEmployee(user.id, organizationId);
  const entry = await prisma.historicalMarEntry.findFirst({ where: { id: input.entryId, organizationId, clientId }, select: { id: true, employeeId: true, matchState: true, reviewState: true, version: true, finalizedDoseId: true } });
  if (!entry) throw new ResourceNotFoundError("Historical MAR entry not found");
  if (entry.employeeId !== employee.id) throw new AuthorizationError("Caregivers may review only entries attributed to themselves");
  if (entry.matchState !== "MATCHED") throw new ValidationError("This entry has unresolved source evidence and cannot be attested");
  if (entry.version !== input.expectedVersion) throw new ConflictError("This historical MAR entry changed after it was opened", "HISTORICAL_MAR_ENTRY_STALE");
  if (entry.reviewState === "ATTESTED" && !input.correctionReason) throw new ValidationError("A correction reason is required to change an attested historical entry");
  if (input.paperStatus === "GIVEN" && !input.paperTimeGiven) throw new ValidationError("Time given is required for a given dose");
  if (input.paperStatus !== "GIVEN" && !input.paperNote) throw new ValidationError("A paper-MAR note is required for refused, held, or not-given doses");
  const flagged = Boolean(input.discrepancyCode || input.discrepancyNote);
  const result = await prisma.historicalMarEntry.updateMany({ where: { id: entry.id, version: entry.version }, data: { paperStatus: input.paperStatus, paperTimeGiven: input.paperStatus === "GIVEN" ? input.paperTimeGiven : null, paperNote: input.paperNote ?? null, discrepancyCode: input.discrepancyCode ?? null, discrepancyNote: input.discrepancyNote ?? null, correctionReason: input.correctionReason ?? null, reviewedByUserId: user.id, reviewedAt: new Date(), reviewState: flagged ? "FLAGGED_FOR_CORRECTION" : "READY_TO_ATTEST", version: { increment: 1 } } });
  if (result.count !== 1) throw new ConflictError("This historical MAR entry changed concurrently", "HISTORICAL_MAR_ENTRY_STALE");
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: flagged ? "client.historical_mar_discrepancy_flagged" : entry.finalizedDoseId ? "client.historical_mar_correction_prepared" : "client.historical_mar_reviewed", entityType: "HistoricalMarEntry", entityId: entry.id, metadataJson: { clientId, employeeId: employee.id, priorVersion: entry.version } } });
  return { ok: true, state: flagged ? "FLAGGED_FOR_CORRECTION" : "READY_TO_ATTEST" };
}

export async function attestHistoricalMarEntries(user: Pick<User, "id">, organizationId: string, clientId: string, batchId: string, entryIds: string[]) {
  requireHistoricalMarEnabled(organizationId);
  const employee = await selfEmployee(user.id, organizationId), uniqueIds = [...new Set(entryIds)].sort();
  if (uniqueIds.length !== entryIds.length) throw new ValidationError("Each historical MAR entry may be selected only once");
  const [signature, entries] = await Promise.all([
    prisma.medicationStaffSignature.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } }),
    prisma.historicalMarEntry.findMany({ where: { id: { in: uniqueIds }, organizationId, clientId, batchId }, orderBy: { id: "asc" } }),
  ]);
  if (!signature) throw new ValidationError("Set up your medication signature before attesting");
  if (entries.length !== uniqueIds.length) throw new ResourceNotFoundError("One or more historical MAR entries were not found");
  for (const entry of entries) {
    if (entry.employeeId !== employee.id || entry.reviewedByUserId !== user.id) throw new AuthorizationError("Caregivers may attest only their own reviewed entries");
    if (entry.matchState !== "MATCHED" || entry.reviewState !== "READY_TO_ATTEST" || !entry.paperStatus) throw new ValidationError("Every selected entry must be reviewed and ready to attest");
  }
  const snapshot = entries.map(entry => ({ id: entry.id, version: entry.version, medicationId: entry.medicationId, doseDate: dateToDayKey(entry.doseDate), scheduledTime: entry.scheduledTime, status: entry.paperStatus, timeGiven: entry.paperTimeGiven, note: entry.paperNote, axisCareVisitId: entry.axisCareVisitId, confidence: entry.confidence, correctionReason: entry.correctionReason, priorAttestationId: entry.attestationId }));
  const snapshotHash = stableHistoricalHash({ organizationId, employeeId: employee.id, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION, entries: snapshot });
  const attestation = await prisma.$transaction(async tx => {
    const current = await tx.historicalMarEntry.findMany({ where: { id: { in: uniqueIds } }, orderBy: { id: "asc" } });
    if (current.some((entry, index) => entry.version !== entries[index].version || entry.reviewState !== "READY_TO_ATTEST")) throw new ConflictError("A selected entry changed before signature", "HISTORICAL_MAR_ATTESTATION_STALE");
    const signed = await tx.historicalMarAttestation.create({ data: { organizationId, batchId, employeeId: employee.id, signerUserId: user.id, medicationSignatureId: signature.id, entryIdsJson: uniqueIds, snapshotJson: snapshot as Prisma.InputJsonValue, snapshotHash, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION, statementSnapshot: HISTORICAL_MAR_ATTESTATION_STATEMENT } });
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
    const remaining = await tx.historicalMarEntry.count({ where: { batchId, matchState: "MATCHED", reviewState: { in: ["AWAITING_CAREGIVER_REVIEW", "READY_TO_ATTEST"] } } });
    const exceptions = await tx.historicalMarEntry.count({ where: { batchId, OR: [{ matchState: { not: "MATCHED" } }, { reviewState: "FLAGGED_FOR_CORRECTION" }] } });
    await tx.historicalMarImportBatch.update({ where: { id: batchId }, data: { status: remaining ? "IN_REVIEW" : exceptions ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED" } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.historical_mar_attested", entityType: "HistoricalMarAttestation", entityId: signed.id, metadataJson: { clientId, employeeId: employee.id, entryCount: uniqueIds.length, snapshotHash, statementVersion: HISTORICAL_MAR_ATTESTATION_VERSION } } });
    return signed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ok: true, attestationId: attestation.id, entryCount: uniqueIds.length, signedAt: attestation.signedAt.toISOString() };
}

export async function getHistoricalMarWorkspace(userId: string, organizationId: string, clientId: string, canAdmin: boolean) {
  const enabled = historicalMarAllowlist().has(organizationId);
  if (!enabled) return { enabled: false, canImport: false, entries: [], batches: [], statement: HISTORICAL_MAR_ATTESTATION_STATEMENT };
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId, employmentStatus: "ACTIVE" }, select: { id: true } });
  const entries = canAdmin || employee ? await prisma.historicalMarEntry.findMany({ where: { organizationId, clientId, ...(canAdmin ? {} : { employeeId: employee!.id }) }, include: { medication: { select: { medication: true, dose: true, route: true } }, employee: { select: { id: true, firstName: true, lastName: true } }, axisCareVisit: { select: { externalId: true, clockInAt: true, clockOutAt: true } }, attestation: { select: { signedAt: true, snapshotHash: true } } }, orderBy: [{ doseDate: "asc" }, { scheduledTime: "asc" }] }) : [];
  const batches = canAdmin ? await prisma.historicalMarImportBatch.findMany({ where: { organizationId, clientId }, select: { id: true, rangeStart: true, rangeEnd: true, status: true, summaryJson: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  return { enabled: true, canImport: canAdmin, statement: HISTORICAL_MAR_ATTESTATION_STATEMENT, batches: batches.map(batch => ({ ...batch, rangeStart: dateToDayKey(batch.rangeStart), rangeEnd: dateToDayKey(batch.rangeEnd), createdAt: batch.createdAt.toISOString() })), entries: entries.map(entry => ({ id: entry.id, batchId: entry.batchId, medication: entry.medication, employee: entry.employee ? { id: entry.employee.id, name: `${entry.employee.firstName} ${entry.employee.lastName}` } : null, mine: Boolean(employee && entry.employeeId === employee.id), doseDate: dateToDayKey(entry.doseDate), scheduledTime: entry.scheduledTime, matchState: entry.matchState, confidence: entry.confidence, reviewState: entry.reviewState, paperStatus: entry.paperStatus, paperTimeGiven: entry.paperTimeGiven, paperNote: entry.paperNote, discrepancyCode: entry.discrepancyCode, discrepancyNote: entry.discrepancyNote, correctionReason: entry.correctionReason, version: entry.version, visit: entry.axisCareVisit ? { externalId: entry.axisCareVisit.externalId, clockInAt: entry.axisCareVisit.clockInAt?.toISOString() ?? null, clockOutAt: entry.axisCareVisit.clockOutAt?.toISOString() ?? null } : null, attestation: entry.attestation ? { signedAt: entry.attestation.signedAt.toISOString(), snapshotHash: entry.attestation.snapshotHash } : null })) };
}

export async function applyHistoricalMarAction(user: Pick<User, "id">, organizationId: string, clientId: string, raw: unknown) {
  const input = historicalMarAction.parse(raw);
  if (input.action === "PREVIEW_HISTORICAL_MAR") return previewHistoricalMarImport(user, organizationId, clientId, input.rangeStart, input.rangeEnd);
  if (input.action === "STAGE_HISTORICAL_MAR") return stageHistoricalMarImport(user, organizationId, clientId, input.rangeStart, input.rangeEnd, input.expectedFingerprint);
  if (input.action === "REVIEW_HISTORICAL_MAR_ENTRY") return reviewHistoricalMarEntry(user, organizationId, clientId, input);
  return attestHistoricalMarEntries(user, organizationId, clientId, input.batchId, input.entryIds);
}
