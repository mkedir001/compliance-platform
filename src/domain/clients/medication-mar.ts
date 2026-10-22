import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { requireOrganizationAccess, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { computeMedicationDutyEligibility } from "@/domain/medication/service";
import { DOSE_STATUSES, MAR_SIGNING_CONSENT_TEXT, MAR_SIGNING_CONSENT_VERSION, addDays, currentTimeKey, dateToDayKey, dayKeyToDate, initialsFor, isDayKey, marSummary, medicationActiveOn, monthDays, monthWeeks, parseScheduleTimes, timeKeyPattern, todayKey, weekStartKey, type DoseStatus } from "@/domain/clients/mar";
import { applyHistoricalMarAction, getHistoricalMarWorkspace, hasHistoricalMarReviewAccess } from "@/domain/clients/historical-mar-import";

const day = z.string().refine(isDayKey, "Use a real date (YYYY-MM-DD)");
const time = z.string().regex(timeKeyPattern, "Use a 24-hour time (HH:mm)");
const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export const medicationRecordAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SETUP_SIGNATURE"), typedName: z.string().trim().min(2).max(120), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("SAVE_MEDICATION"), id: z.string().cuid().optional(), medication: z.string().trim().min(1).max(200), dose: z.string().trim().max(100).nullish(), route: z.string().trim().max(100).nullish(), times: z.string().trim().max(500).nullish(), reason: z.string().trim().max(300).nullish(), prescriber: z.string().trim().max(200).nullish(), startDate: day.nullish(), stopDate: day.nullish() }).strict(),
  z.object({ action: z.literal("SAVE_DOSE"), medicationId: z.string().cuid(), doseDate: day, scheduledTime: time, status: z.enum(DOSE_STATUSES as unknown as [DoseStatus, ...DoseStatus[]]), timeGiven: time.nullish(), note: z.string().trim().max(1000).nullish(), lateEntryReason: z.string().trim().min(10).max(500).nullish(), correctionReason: z.string().trim().min(10).max(500).nullish(), expectedUpdatedAt: z.string().datetime().optional() }).strict(),
  z.object({ action: z.literal("APPROVE_MEDICATION"), id: z.string().cuid() }).strict(),
  z.object({ action: z.literal("APPROVE_HISTORICAL_MEDICATION"), id: z.string().cuid(), effectiveFrom: day, effectiveThrough: day, sourceReference: z.string().trim().min(3).max(300) }).strict(),
  z.object({ action: z.literal("SIGN_WEEK"), weekStart: day }).strict(),
]);
export type MedicationRecordAction = z.infer<typeof medicationRecordAction>;

type AssignmentGate = { employeeId: string; assignmentId: string; eligible: boolean; reasons: string[] } | null;
type Access = { userId: string; organizationId: string; timezone: string; permissions: Set<string>; canAdminView: boolean; canReview: boolean; canEditMedications: boolean; canProposeMedications: boolean; assignmentGate: AssignmentGate; historicalOnly: boolean };

async function resolveAssignmentGate(userId: string, organizationId: string, clientId: string, now: Date): Promise<AssignmentGate> {
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId, employmentStatus: "ACTIVE" }, select: { id: true } });
  if (!employee) return null;
  const assignment = await prisma.serviceAssignment.findFirst({ where: { organizationId, employeeId: employee.id, serviceRecipientRef: clientId, status: "ACTIVE", blockingScope: "MEDICATION_ADMINISTRATION", medicationPathwayId: { not: null }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] }, select: { id: true, medicationPathwayId: true }, orderBy: { startsAt: "desc" } });
  if (!assignment?.medicationPathwayId) return null;
  const result = await computeMedicationDutyEligibility(organizationId, employee.id, assignment.medicationPathwayId, clientId, now);
  return { employeeId: employee.id, assignmentId: assignment.id, eligible: result.eligible, reasons: result.reasonCodes };
}

async function hasAssignedClientAccess(userId: string, organizationId: string, clientId: string, now: Date) {
  return Boolean(await prisma.serviceAssignment.findFirst({ where: { organizationId, serviceRecipientRef: clientId, status: "ACTIVE", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }], employee: { userId, employmentStatus: "ACTIVE" } }, select: { id: true } }));
}

async function access(user: Pick<User, "id">, organizationId: string, clientId: string): Promise<Access> {
  const { organization, membership } = await requireOrganizationAccess(user, organizationId);
  const permissions = await resolvePermissionCodes(membership.id), canAdminView = permissions.has("medication.approve"), assignedRead = permissions.has("medication.assigned.read") || permissions.has("medication.activity.record"), now = new Date();
  const historicalPrivileged = ["historical_mar.reconstruct", "historical_mar.review", "historical_mar.correct", "historical_mar.attest"].some(code => permissions.has(code));
  const assignedClient = canAdminView ? true : await hasAssignedClientAccess(user.id, organizationId, clientId, now), historicalReview = canAdminView ? false : await hasHistoricalMarReviewAccess(user.id, organizationId, clientId);
  if (!canAdminView && !historicalPrivileged && (!assignedRead || (!assignedClient && !historicalReview))) throw new AuthorizationError("Assigned-client medication access is required");
  if (!await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } })) throw new ResourceNotFoundError("Client not found");
  const clinicalCredential = canAdminView ? await prisma.professionalCredential.findFirst({ where: { organizationId, userId: user.id, status: "ACTIVE", verificationStatus: "VERIFIED", credentialType: { in: ["RN", "CNS", "CNP", "PA", "PHYSICIAN"] }, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, select: { id: true } }) : null;
  // Permission to reach the review workflow is not a substitute for a current,
  // verified clinical credential. This remains true for master accounts.
  const canReview = Boolean(canAdminView && clinicalCredential), assignmentGate = permissions.has("medication.activity.record") ? await resolveAssignmentGate(user.id, organizationId, clientId, now) : null;
  return { userId: user.id, organizationId, timezone: organization.timezone, permissions, canAdminView, canReview, canEditMedications: canReview, canProposeMedications: canReview || permissions.has("organization.manage") || permissions.has("client.update"), assignmentGate, historicalOnly: !canAdminView && !assignedClient && !historicalPrivileged && historicalReview };
}

function requireAdministration(a: Access) {
  if (!a.permissions.has("medication.activity.record")) throw new AuthorizationError("Missing permission: medication.activity.record");
  if (!a.assignmentGate) throw new AuthorizationError("An active medication-administration assignment for this client is required");
  if (!a.assignmentGate.eligible) throw new AuthorizationError(`Medication administration is blocked: ${a.assignmentGate.reasons.join(", ") || "current qualification and authorization are required"}`);
  return a.assignmentGate;
}

const snapshot = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const trimOrNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
const doseKey = (medicationId: string, doseDate: string, scheduledTime: string) => ({ medicationId_doseDate_scheduledTime: { medicationId, doseDate: dayKeyToDate(doseDate), scheduledTime } });
async function storedSignature(organizationId: string, userId: string) { return prisma.medicationStaffSignature.findUnique({ where: { organizationId_userId: { organizationId, userId } } }); }

async function recordHistory(tx: Prisma.TransactionClient, data: { organizationId: string; clientId: string; entityType: string; entityId: string; action: string; changedByUserId: string; snapshotJson: Prisma.InputJsonValue }) {
  await tx.clientMedicationHistory.create({ data });
  await tx.auditEvent.create({ data: { organizationId: data.organizationId, actorUserId: data.changedByUserId, eventType: `client.medication_${data.action.toLowerCase()}`, entityType: data.entityType, entityId: data.entityId, metadataJson: { clientId: data.clientId } } });
}

export async function recordMedicationAuthorizationFailure(userId: string, organizationId: string, clientId: string, operation: "READ" | "WRITE") {
  const [membership, client] = await Promise.all([
    prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { status: true } }),
    prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } }),
  ]);
  if (membership?.status !== "ACTIVE" || !client) return;
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: userId, eventType: "client.medication_authorization_denied", entityType: "Client", entityId: clientId, metadataJson: { operation } } });
}

export async function getMedicationRecord(user: Pick<User, "id">, organizationId: string, clientId: string, monthRaw: string) {
  const a = await access(user, organizationId, clientId), month = monthInput.parse(monthRaw), days = monthDays(month), today = todayKey(new Date(), a.timezone);
  const [medications, doses, signoffs, mine, historical] = await Promise.all([
    prisma.clientMedication.findMany({ where: { organizationId, clientId, ...(a.historicalOnly ? { historicalMarEntries: { some: { employee: { userId: a.userId } } } } : {}) }, orderBy: [{ createdAt: "asc" }, { medication: "asc" }] }),
    prisma.clientMedicationDose.findMany({ where: { organizationId, clientId, doseDate: { gte: dayKeyToDate(days[0]), lte: dayKeyToDate(days[days.length - 1]) }, ...(a.historicalOnly ? { historicalImportEntry: { is: { employee: { userId: a.userId } } } } : {}) } }),
    a.historicalOnly ? Promise.resolve([]) : prisma.clientMedicationWeekSignoff.findMany({ where: { organizationId, clientId, weekStart: { gte: dayKeyToDate(monthWeeks(month)[0].weekStart), lte: dayKeyToDate(days[days.length - 1]) } } }),
    storedSignature(organizationId, a.userId),
    getHistoricalMarWorkspace(a.userId, organizationId, clientId, a.canReview),
  ]);
  const meds = medications.map(row => ({ id: row.id, medication: row.medication, dose: row.dose, route: row.route, times: row.times, reason: row.reason, prescriber: row.prescriber, startDate: row.startDate ? dateToDayKey(row.startDate) : null, stopDate: row.stopDate ? dateToDayKey(row.stopDate) : null, marApproved: Boolean(row.marApprovedAt && row.marApprovedByUserId), historicalApprovedFrom: row.historicalApprovedFrom ? dateToDayKey(row.historicalApprovedFrom) : null, historicalApprovedThrough: row.historicalApprovedThrough ? dateToDayKey(row.historicalApprovedThrough) : null }));
  const doseRows = doses.map(row => ({ id: row.id, medicationId: row.medicationId, doseDate: dateToDayKey(row.doseDate), scheduledTime: row.scheduledTime, status: row.status as DoseStatus, timeGiven: row.timeGiven, note: row.note, signerUserId: row.signerUserId, signerName: row.signerName, signerInitials: row.signerInitials, signedAt: row.signedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), correctionReason: row.correctionReason, transferredFromPaper: row.transferredFromPaper }));
  const canRecord = Boolean(a.permissions.has("medication.activity.record") && a.assignmentGate?.eligible);
  const canHistoricalReview = historical.enabled && Boolean(historical.canReview || historical.canAttest);
  const payload = {
    month, today,
    me: { userId: a.userId, hasSignature: Boolean(mine), canRecord, canHistoricalReview, canSignWeek: a.canReview, isManager: a.canReview, canEditMedications: a.canEditMedications, canProposeMedications: a.canProposeMedications, administrationBlockers: a.permissions.has("medication.activity.record") && !canRecord ? a.assignmentGate?.reasons ?? ["ACTIVE_CLIENT_MEDICATION_ASSIGNMENT_REQUIRED"] : [] },
    consent: { version: MAR_SIGNING_CONSENT_VERSION, text: MAR_SIGNING_CONSENT_TEXT }, medications: meds, doses: doseRows,
    weeks: monthWeeks(month).map(week => { const row = signoffs.find(item => dateToDayKey(item.weekStart) === week.weekStart); return { ...week, signoff: row ? { signerName: row.signerName } : null }; }),
    staff: mine ? [{ userId: mine.userId, typedName: mine.typedName, initials: mine.initials }] : [], historical,
    admin: null as null | { summary: ReturnType<typeof marSummary>; entries: Record<string, { enteredAt: string; signedAt: string; appliedBy: string | null; attestedInPerson: boolean; transferredFromPaper: boolean }>; history: { id: string; entityType: string; action: string; changedAt: string; changedBy: string; label: string; snapshot: unknown }[] },
  };
  if (a.canAdminView) {
    const rows = await prisma.clientMedicationHistory.findMany({ where: { organizationId, clientId }, orderBy: { changedAt: "desc" }, take: 200 });
    const ids = [...new Set([...rows.map(row => row.changedByUserId), ...doses.map(row => row.appliedByUserId)])];
    const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }), nameOf = (id: string) => people.find(row => row.id === id)?.email ?? null;
    payload.admin = { summary: marSummary(meds, doseRows, days, today), entries: Object.fromEntries(doses.map(row => [row.id, { enteredAt: row.createdAt.toISOString(), signedAt: row.signedAt.toISOString(), appliedBy: nameOf(row.appliedByUserId), attestedInPerson: row.attestedInPerson, transferredFromPaper: row.transferredFromPaper }])), history: rows.map(row => ({ id: row.id, entityType: row.entityType, action: row.action, changedAt: row.changedAt.toISOString(), changedBy: nameOf(row.changedByUserId) ?? "Unknown", label: String((row.snapshotJson as { label?: unknown } | null)?.label ?? ""), snapshot: row.snapshotJson })) };
  }
  return payload;
}

export async function applyMedicationAction(user: Pick<User, "id">, organizationId: string, clientId: string, raw: unknown) {
  if (raw && typeof raw === "object" && "action" in raw && typeof raw.action === "string" && (raw.action.includes("HISTORICAL_MAR") || raw.action === "INSPECT_PAVILIO_ATTENDANCE")) return applyHistoricalMarAction(user, organizationId, clientId, raw);
  const a = await access(user, organizationId, clientId), input = medicationRecordAction.parse(raw);
  if (input.action === "SETUP_SIGNATURE") {
    if (!a.permissions.has("medication.activity.record") && !a.canReview && !await hasHistoricalMarReviewAccess(a.userId, organizationId, clientId)) throw new AuthorizationError("Medication signing permission is required");
    if (await storedSignature(organizationId, a.userId)) throw new ValidationError("Your signature is already set up");
    const base = initialsFor(input.typedName) || "XX", taken = new Set((await prisma.medicationStaffSignature.findMany({ where: { organizationId }, select: { initials: true } })).map(row => row.initials));
    let initials = base; for (let n = 2; taken.has(initials); n++) initials = `${base}${n}`;
    await prisma.medicationStaffSignature.create({ data: { organizationId, userId: a.userId, typedName: input.typedName, initials, consentVersion: MAR_SIGNING_CONSENT_VERSION, consentedAt: new Date() } });
    return { ok: true };
  }
  if (input.action === "SAVE_MEDICATION") {
    if (!a.canProposeMedications) throw new AuthorizationError("Missing permission: organization.manage or medication.approve");
    const fields = { medication: input.medication, dose: trimOrNull(input.dose), route: trimOrNull(input.route), times: trimOrNull(input.times), reason: trimOrNull(input.reason), prescriber: trimOrNull(input.prescriber), startDate: input.startDate ? dayKeyToDate(input.startDate) : null, stopDate: input.stopDate ? dayKeyToDate(input.stopDate) : null };
    const data = { ...fields };
    const pendingApproval = { marApprovedAt: null, marApprovedByUserId: null, historicalApprovedFrom: null, historicalApprovedThrough: null, historicalApprovalSourceReference: null };
    if (data.startDate && data.stopDate && data.stopDate < data.startDate) throw new ValidationError("The stop date cannot be before the start date");
    if (input.id) {
      const existing = await prisma.clientMedication.findFirst({ where: { id: input.id, organizationId, clientId } }); if (!existing) throw new ResourceNotFoundError("Medication not found");
      const sameDay = (x: Date | null, y: Date | null) => (x?.getTime() ?? null) === (y?.getTime() ?? null);
      const orderFieldsUnchanged = existing.medication === data.medication && existing.dose === data.dose && existing.route === data.route && existing.times === data.times && existing.reason === data.reason && existing.prescriber === data.prescriber && sameDay(existing.startDate, data.startDate);
      const stopUnchanged = sameDay(existing.stopDate, data.stopDate);
      const isDiscontinuation = Boolean(data.stopDate && (!existing.stopDate || data.stopDate < existing.stopDate));
      // A no-op save or an earlier stop date does not expand an approved order.
      // Any other change invalidates the approval, even when made by a reviewer.
      const keepApproval = Boolean(existing.marApprovedAt && existing.marApprovedByUserId && orderFieldsUnchanged && (stopUnchanged || isDiscontinuation));
      await prisma.$transaction(async tx => { const updated = await tx.clientMedication.update({ where: { id: input.id }, data: keepApproval ? data : { ...data, ...pendingApproval } }); await recordHistory(tx, { organizationId, clientId, entityType: "MEDICATION", entityId: input.id!, action: isDiscontinuation ? "DISCONTINUED" : "UPDATED", changedByUserId: a.userId, snapshotJson: snapshot({ label: existing.medication, before: existing, after: updated }) }); });
      return { ok: true, id: input.id };
    }
    const created = await prisma.$transaction(async tx => { const row = await tx.clientMedication.create({ data: { organizationId, clientId, ...data, ...pendingApproval } }); await recordHistory(tx, { organizationId, clientId, entityType: "MEDICATION", entityId: row.id, action: "CREATED", changedByUserId: a.userId, snapshotJson: snapshot({ label: row.medication, after: row }) }); return row; });
    return { ok: true, id: created.id };
  }
  if (input.action === "APPROVE_MEDICATION") {
    if (!a.canEditMedications) throw new AuthorizationError("Only a clinical reviewer can approve a medication for the MAR");
    const existing = await prisma.clientMedication.findFirst({ where: { id: input.id, organizationId, clientId } }); if (!existing) throw new ResourceNotFoundError("Medication not found");
    if (existing.marApprovedAt && existing.marApprovedByUserId) throw new ValidationError("This medication is already approved for the MAR");
    if (!existing.startDate) throw new ValidationError("A start date is required before MAR approval");
    if (!parseScheduleTimes(existing.times).length) throw new ValidationError("A structured medication schedule is required before MAR approval");
    if (existing.stopDate && dateToDayKey(existing.stopDate) < todayKey(new Date(), a.timezone)) throw new ValidationError("An ended medication cannot be approved for the MAR");
    await prisma.$transaction(async tx => { const updated = await tx.clientMedication.update({ where: { id: input.id }, data: { marApprovedAt: new Date(), marApprovedByUserId: a.userId } }); await recordHistory(tx, { organizationId, clientId, entityType: "MEDICATION", entityId: input.id, action: "APPROVED", changedByUserId: a.userId, snapshotJson: snapshot({ label: existing.medication, before: existing, after: updated }) }); });
    return { ok: true, id: input.id };
  }
  if (input.action === "APPROVE_HISTORICAL_MEDICATION") {
    if (!a.canEditMedications) throw new AuthorizationError("Only a current verified clinical reviewer can authorize a historical medication schedule");
    const existing = await prisma.clientMedication.findFirst({ where: { id: input.id, organizationId, clientId } }); if (!existing) throw new ResourceNotFoundError("Medication not found");
    if (!existing.startDate) throw new ValidationError("A historical start date is required before retrospective authorization");
    if (!parseScheduleTimes(existing.times).length) throw new ValidationError("A structured scheduled medication is required; PRN medications are excluded");
    if (input.effectiveFrom > input.effectiveThrough) throw new ValidationError("The retrospective authorization start must not be after its end");
    if (input.effectiveThrough > todayKey(new Date(), a.timezone)) throw new ValidationError("Retrospective authorization cannot include a future date");
    const medicationStart = dateToDayKey(existing.startDate), medicationStop = existing.stopDate ? dateToDayKey(existing.stopDate) : null;
    if (input.effectiveFrom < medicationStart || (medicationStop && input.effectiveThrough > medicationStop)) throw new ValidationError("The retrospective authorization must stay within the recorded medication effective dates");
    const now = new Date();
    await prisma.$transaction(async tx => {
      const updated = await tx.clientMedication.update({ where: { id: input.id }, data: { marApprovedAt: now, marApprovedByUserId: a.userId, historicalApprovedFrom: dayKeyToDate(input.effectiveFrom), historicalApprovedThrough: dayKeyToDate(input.effectiveThrough), historicalApprovalSourceReference: input.sourceReference } });
      await tx.historicalMarEntry.updateMany({ where: { organizationId, clientId, medicationId: input.id, doseDate: { gte: dayKeyToDate(input.effectiveFrom), lte: dayKeyToDate(input.effectiveThrough) }, medicationAuthorizationState: "UNAPPROVED_DRAFT" }, data: { medicationAuthorizationState: "APPROVED", medicationAuthorizationSnapshotJson: { approvedAt: now.toISOString(), approvedByUserId: a.userId, effectiveFrom: input.effectiveFrom, effectiveThrough: input.effectiveThrough, sourceReference: input.sourceReference } } });
      await recordHistory(tx, { organizationId, clientId, entityType: "MEDICATION", entityId: input.id, action: "RETROSPECTIVELY_AUTHORIZED", changedByUserId: a.userId, snapshotJson: snapshot({ label: existing.medication, before: existing, after: updated, authorizationRecordedAt: now.toISOString(), effectiveFrom: input.effectiveFrom, effectiveThrough: input.effectiveThrough, sourceReference: input.sourceReference }) });
    });
    return { ok: true, id: input.id };
  }
  if (input.action === "SAVE_DOSE") {
    const gate = requireAdministration(a), today = todayKey(new Date(), a.timezone);
    if (input.doseDate > today) throw new ValidationError("A dose cannot be recorded for a future date");
    if (input.doseDate < addDays(today, -7)) throw new ValidationError("Online MAR entries are limited to the current day and prior seven days; use the governed correction process for older records");
    if (input.doseDate < today && !input.lateEntryReason) throw new ValidationError("A late-entry reason is required for a past date");
    if (input.status !== "GIVEN" && !trimOrNull(input.note)) throw new ValidationError("A note is required for refused, held, or not-given doses");
    if (input.status === "GIVEN" && !input.timeGiven) throw new ValidationError("Time given is required");
    if (input.doseDate === today && input.scheduledTime > currentTimeKey(new Date(), a.timezone)) throw new ValidationError("A scheduled dose cannot be documented before its scheduled time");
    if (input.doseDate === today && input.timeGiven && input.timeGiven > currentTimeKey(new Date(), a.timezone)) throw new ValidationError("Time given cannot be in the future");
    const medication = await prisma.clientMedication.findFirst({ where: { id: input.medicationId, organizationId, clientId } }); if (!medication) throw new ResourceNotFoundError("Medication not found");
    if (!medication.marApprovedAt || !medication.marApprovedByUserId) throw new AuthorizationError("This medication has not been explicitly approved for MAR documentation");
    if (!medicationActiveOn({ startDate: medication.startDate ? dateToDayKey(medication.startDate) : null, stopDate: medication.stopDate ? dateToDayKey(medication.stopDate) : null }, input.doseDate)) throw new ValidationError("This medication is not active on the selected date");
    const schedule = parseScheduleTimes(medication.times); if (!schedule.length) throw new ValidationError("PRN or unstructured schedules cannot be documented in this MAR workflow");
    if (!schedule.includes(input.scheduledTime)) throw new ValidationError("The selected time is not in the current medication schedule");
    const signature = await storedSignature(organizationId, a.userId); if (!signature) throw new ValidationError("Set up your signature before signing");
    const key = doseKey(input.medicationId, input.doseDate, input.scheduledTime), data = { status: input.status, timeGiven: input.status === "GIVEN" ? input.timeGiven : null, note: trimOrNull(input.note), signerUserId: a.userId, signerName: signature.typedName, signerInitials: signature.initials, appliedByUserId: a.userId, attestedInPerson: false, transferredFromPaper: false, correctionReason: trimOrNull(input.correctionReason) ?? trimOrNull(input.lateEntryReason), signedAt: new Date() };
    try {
      await prisma.$transaction(async tx => {
        const existing = await tx.clientMedicationDose.findUnique({ where: key });
        if (existing) {
          if (!input.correctionReason) throw new ValidationError("A correction reason is required to change an existing MAR entry");
          if (!input.expectedUpdatedAt || existing.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictError("This MAR entry changed after it was opened. Reload and review the latest entry.", "MAR_ENTRY_STALE");
          const changed = await tx.clientMedicationDose.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt }, data }); if (changed.count !== 1) throw new ConflictError("This MAR entry changed concurrently. Reload and try again.", "MAR_ENTRY_STALE");
          const updated = await tx.clientMedicationDose.findUniqueOrThrow({ where: { id: existing.id } });
          await recordHistory(tx, { organizationId, clientId, entityType: "DOSE", entityId: existing.id, action: "CORRECTED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `${medication.medication} ${input.doseDate} ${input.scheduledTime}`, before: existing, after: updated, correctionReason: input.correctionReason, assignmentId: gate.assignmentId }) });
        } else {
          const row = await tx.clientMedicationDose.create({ data: { organizationId, clientId, medicationId: input.medicationId, doseDate: dayKeyToDate(input.doseDate), scheduledTime: input.scheduledTime, ...data } });
          await recordHistory(tx, { organizationId, clientId, entityType: "DOSE", entityId: row.id, action: "ENTERED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `${medication.medication} ${input.doseDate} ${input.scheduledTime}`, after: row, lateEntryReason: input.lateEntryReason, assignmentId: gate.assignmentId }) });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError("This MAR slot was documented concurrently. Reload and review the existing entry.", "MAR_ENTRY_ALREADY_EXISTS");
      throw error;
    }
    return { ok: true };
  }
  if (!a.canReview) throw new AuthorizationError("Missing permission: medication.approve");
  if (weekStartKey(input.weekStart) !== input.weekStart) throw new ValidationError("A week starts on a Monday");
  if (input.weekStart > todayKey(new Date(), a.timezone)) throw new ValidationError("A future week cannot be signed");
  const signature = await storedSignature(organizationId, a.userId); if (!signature) throw new ValidationError("Set up your signature before signing");
  const key = { clientId_weekStart: { clientId, weekStart: dayKeyToDate(input.weekStart) } };
  await prisma.$transaction(async tx => { if (await tx.clientMedicationWeekSignoff.findUnique({ where: key })) throw new ConflictError("This week is already signed. Sign-offs are immutable.", "MAR_WEEK_ALREADY_SIGNED"); const row = await tx.clientMedicationWeekSignoff.create({ data: { organizationId, clientId, weekStart: dayKeyToDate(input.weekStart), signerUserId: a.userId, signerName: signature.typedName, appliedByUserId: a.userId, attestedInPerson: false, signedAt: new Date() } }); await recordHistory(tx, { organizationId, clientId, entityType: "WEEK_SIGNOFF", entityId: row.id, action: "ENTERED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `Week of ${input.weekStart}`, after: row }) }); });
  return { ok: true };
}
