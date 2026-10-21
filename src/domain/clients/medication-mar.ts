import type { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { requireOrganizationAccess, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { DOSE_STATUSES, MAR_SIGNING_CONSENT_TEXT, MAR_SIGNING_CONSENT_VERSION, dateToDayKey, dayKeyToDate, initialsFor, isDayKey, marSummary, monthDays, monthWeeks, timeKeyPattern, todayKey, weekStartKey, type DoseStatus } from "@/domain/clients/mar";

const day = z.string().refine(isDayKey, "Use a real date (YYYY-MM-DD)");
const time = z.string().regex(timeKeyPattern, "Use a 24-hour time (HH:mm)");
const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export const medicationRecordAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SETUP_SIGNATURE"), typedName: z.string().trim().min(2).max(120), consent: z.literal(true) }),
  z.object({ action: z.literal("SAVE_MEDICATION"), id: z.string().cuid().optional(), medication: z.string().trim().min(1).max(200), dose: z.string().trim().max(100).nullish(), route: z.string().trim().max(100).nullish(), times: z.string().trim().max(500).nullish(), reason: z.string().trim().max(300).nullish(), prescriber: z.string().trim().max(200).nullish(), startDate: day.nullish(), stopDate: day.nullish() }),
  z.object({ action: z.literal("SAVE_DOSE"), medicationId: z.string().cuid(), doseDate: day, scheduledTime: time, status: z.enum(DOSE_STATUSES as unknown as [DoseStatus, ...DoseStatus[]]), timeGiven: time.nullish(), note: z.string().trim().max(1000).nullish(), signerUserId: z.string().cuid().optional(), transferredFromPaper: z.boolean().default(false), attestedInPerson: z.boolean().default(false) }),
  z.object({ action: z.literal("CLEAR_DOSE"), medicationId: z.string().cuid(), doseDate: day, scheduledTime: time }),
  z.object({ action: z.literal("SIGN_WEEK"), weekStart: day, signerUserId: z.string().cuid().optional(), attestedInPerson: z.boolean().default(false) }),
]);
export type MedicationRecordAction = z.infer<typeof medicationRecordAction>;

type Access = { userId: string; organizationId: string; permissions: Set<string>; isManager: boolean; canRecord: boolean; canSignWeek: boolean };

async function access(user: Pick<User, "id">, organizationId: string, clientId: string): Promise<Access> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const permissions = await resolvePermissionCodes(membership.id);
  const isManager = permissions.has("organization.manage");
  const canView = isManager || ["client.read", "client.update", "medication.assigned.read", "medication.activity.record"].some(code => permissions.has(code));
  if (!canView) throw new AuthorizationError("Missing permission: medication.assigned.read");
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!client) throw new ResourceNotFoundError("Client not found");
  return { userId: user.id, organizationId, permissions, isManager, canRecord: isManager || permissions.has("medication.activity.record") || permissions.has("client.update"), canSignWeek: isManager || permissions.has("medication.approve") || permissions.has("clinical.review") };
}
const requireRecord = (a: Access) => { if (!a.canRecord) throw new AuthorizationError("Missing permission: medication.activity.record"); };

const snapshot = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const trimOrNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

async function storedSignature(organizationId: string, userId: string) {
  return prisma.medicationStaffSignature.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
}

/** Signer for an entry: yourself, or (administrators only) another staff member who attested in person. */
async function resolveSigner(a: Access, signerUserId: string | undefined, attestedInPerson: boolean, transferredFromPaper: boolean) {
  const signerId = signerUserId ?? a.userId, onBehalf = signerId !== a.userId;
  if (onBehalf) {
    if (!a.isManager) throw new AuthorizationError("Only an administrator can sign on behalf of another staff member");
    if (!attestedInPerson && !transferredFromPaper) throw new ValidationError("Confirm the staff member attested in person, or mark the entry as transferred from a paper MAR");
  }
  const signature = await storedSignature(a.organizationId, signerId);
  if (!signature) throw new ValidationError(onBehalf ? "That staff member has not set up a signature yet" : "Set up your signature before signing");
  return { signature, onBehalf };
}

export async function getMedicationRecord(user: Pick<User, "id">, organizationId: string, clientId: string, monthRaw: string) {
  const a = await access(user, organizationId, clientId), month = monthInput.parse(monthRaw), days = monthDays(month), today = todayKey();
  const [medications, doses, signoffs, signatures, mine] = await Promise.all([
    prisma.clientMedication.findMany({ where: { organizationId, clientId }, orderBy: [{ createdAt: "asc" }, { medication: "asc" }] }),
    prisma.clientMedicationDose.findMany({ where: { organizationId, clientId, doseDate: { gte: dayKeyToDate(days[0]), lte: dayKeyToDate(days[days.length - 1]) } } }),
    prisma.clientMedicationWeekSignoff.findMany({ where: { organizationId, clientId, weekStart: { gte: dayKeyToDate(monthWeeks(month)[0].weekStart), lte: dayKeyToDate(days[days.length - 1]) } } }),
    prisma.medicationStaffSignature.findMany({ where: { organizationId }, orderBy: { typedName: "asc" } }),
    storedSignature(organizationId, a.userId),
  ]);
  const meds = medications.map(row => ({ id: row.id, medication: row.medication, dose: row.dose, route: row.route, times: row.times, reason: row.reason, prescriber: row.prescriber, startDate: row.startDate ? dateToDayKey(row.startDate) : null, stopDate: row.stopDate ? dateToDayKey(row.stopDate) : null }));
  const doseRows = doses.map(row => ({ id: row.id, medicationId: row.medicationId, doseDate: dateToDayKey(row.doseDate), scheduledTime: row.scheduledTime, status: row.status as DoseStatus, timeGiven: row.timeGiven, note: row.note, signerUserId: row.signerUserId, signerName: row.signerName, signerInitials: row.signerInitials, transferredFromPaper: row.transferredFromPaper }));
  const payload = {
    month, today,
    me: { userId: a.userId, hasSignature: Boolean(mine), canRecord: a.canRecord, canSignWeek: a.canSignWeek, isManager: a.isManager, canEditMedications: a.isManager || a.permissions.has("client.update") },
    consent: { version: MAR_SIGNING_CONSENT_VERSION, text: MAR_SIGNING_CONSENT_TEXT },
    medications: meds,
    doses: doseRows,
    weeks: monthWeeks(month).map(week => { const row = signoffs.find(item => dateToDayKey(item.weekStart) === week.weekStart); return { ...week, signoff: row ? { signerName: row.signerName } : null }; }),
    staff: signatures.map(row => ({ userId: row.userId, typedName: row.typedName, initials: row.initials })),
    admin: null as null | { summary: ReturnType<typeof marSummary>; entries: Record<string, { enteredAt: string; signedAt: string; appliedBy: string | null; attestedInPerson: boolean }>; history: { id: string; entityType: string; action: string; changedAt: string; changedBy: string; label: string; snapshot: unknown }[] },
  };
  if (a.isManager) {
    const history = await prisma.clientMedicationHistory.findMany({ where: { organizationId, clientId }, orderBy: { changedAt: "desc" }, take: 200 });
    const ids = [...new Set([...history.map(row => row.changedByUserId), ...doses.map(row => row.appliedByUserId)])];
    const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const nameOf = (id: string) => signatures.find(row => row.userId === id)?.typedName ?? people.find(row => row.id === id)?.email ?? null;
    payload.admin = {
      summary: marSummary(meds, doseRows, days, today),
      entries: Object.fromEntries(doses.map(row => [row.id, { enteredAt: row.createdAt.toISOString(), signedAt: row.signedAt.toISOString(), appliedBy: nameOf(row.appliedByUserId), attestedInPerson: row.attestedInPerson }])),
      history: history.map(row => ({ id: row.id, entityType: row.entityType, action: row.action, changedAt: row.changedAt.toISOString(), changedBy: nameOf(row.changedByUserId) ?? "Unknown", label: String((row.snapshotJson as { label?: unknown } | null)?.label ?? ""), snapshot: row.snapshotJson })),
    };
  }
  return payload;
}

export async function applyMedicationAction(user: Pick<User, "id">, organizationId: string, clientId: string, raw: unknown) {
  const a = await access(user, organizationId, clientId), input = medicationRecordAction.parse(raw);
  if (input.action === "SETUP_SIGNATURE") {
    const existing = await storedSignature(organizationId, a.userId);
    if (existing) throw new ValidationError("Your signature is already set up");
    const base = initialsFor(input.typedName) || "XX", taken = new Set((await prisma.medicationStaffSignature.findMany({ where: { organizationId }, select: { initials: true } })).map(row => row.initials));
    let initials = base; for (let n = 2; taken.has(initials); n++) initials = `${base}${n}`;
    await prisma.medicationStaffSignature.create({ data: { organizationId, userId: a.userId, typedName: input.typedName, initials, consentVersion: MAR_SIGNING_CONSENT_VERSION, consentedAt: new Date() } });
    return { ok: true };
  }
  if (input.action === "SAVE_MEDICATION") {
    if (!(a.isManager || a.permissions.has("client.update"))) throw new AuthorizationError("Missing permission: client.update");
    const data = { medication: input.medication, dose: trimOrNull(input.dose), route: trimOrNull(input.route), times: trimOrNull(input.times), reason: trimOrNull(input.reason), prescriber: trimOrNull(input.prescriber), startDate: input.startDate ? dayKeyToDate(input.startDate) : null, stopDate: input.stopDate ? dayKeyToDate(input.stopDate) : null };
    if (data.startDate && data.stopDate && data.stopDate < data.startDate) throw new ValidationError("The stop date cannot be before the start date");
    if (input.id) {
      const existing = await prisma.clientMedication.findFirst({ where: { id: input.id, organizationId, clientId } });
      if (!existing) throw new ResourceNotFoundError("Medication not found");
      await prisma.$transaction([
        prisma.clientMedication.update({ where: { id: input.id }, data }),
        prisma.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "MEDICATION", entityId: input.id, action: "UPDATED", changedByUserId: a.userId, snapshotJson: snapshot({ label: existing.medication, before: existing }) } }),
      ]);
      return { ok: true, id: input.id };
    }
    const created = await prisma.clientMedication.create({ data: { organizationId, clientId, ...data } });
    return { ok: true, id: created.id };
  }
  if (input.action === "SAVE_DOSE") {
    requireRecord(a);
    if (input.doseDate > todayKey()) throw new ValidationError("A dose cannot be recorded for a future date");
    const medication = await prisma.clientMedication.findFirst({ where: { id: input.medicationId, organizationId, clientId } });
    if (!medication) throw new ResourceNotFoundError("Medication not found");
    if (input.status === "GIVEN" && !input.timeGiven && input.scheduledTime) input.timeGiven = input.scheduledTime;
    const { signature, onBehalf } = await resolveSigner(a, input.signerUserId, input.attestedInPerson, input.transferredFromPaper);
    const key = { medicationId_doseDate_scheduledTime: { medicationId: input.medicationId, doseDate: dayKeyToDate(input.doseDate), scheduledTime: input.scheduledTime } };
    const data = { status: input.status, timeGiven: input.status === "GIVEN" ? input.timeGiven ?? null : null, note: trimOrNull(input.note), signerUserId: signature.userId, signerName: signature.typedName, signerInitials: signature.initials, appliedByUserId: a.userId, attestedInPerson: onBehalf ? input.attestedInPerson : false, transferredFromPaper: input.transferredFromPaper, signedAt: new Date() };
    await prisma.$transaction(async tx => {
      const existing = await tx.clientMedicationDose.findUnique({ where: key });
      const row = await tx.clientMedicationDose.upsert({ where: key, create: { organizationId, clientId, medicationId: input.medicationId, doseDate: dayKeyToDate(input.doseDate), scheduledTime: input.scheduledTime, ...data }, update: data });
      await tx.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "DOSE", entityId: row.id, action: existing ? "REPLACED" : "ENTERED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `${medication.medication} ${input.doseDate} ${input.scheduledTime}`, ...(existing ? { before: existing } : {}), after: row }) } });
    });
    return { ok: true };
  }
  if (input.action === "CLEAR_DOSE") {
    requireRecord(a);
    const existing = await prisma.clientMedicationDose.findFirst({ where: { organizationId, clientId, medicationId: input.medicationId, doseDate: dayKeyToDate(input.doseDate), scheduledTime: input.scheduledTime }, include: { medication: { select: { medication: true } } } });
    if (!existing) return { ok: true };
    await prisma.$transaction([
      prisma.clientMedicationDose.delete({ where: { id: existing.id } }),
      prisma.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "DOSE", entityId: existing.id, action: "CLEARED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `${existing.medication.medication} ${input.doseDate} ${input.scheduledTime}`, before: { ...existing, medication: undefined } }) } }),
    ]);
    return { ok: true };
  }
  // SIGN_WEEK
  if (!a.canSignWeek) throw new AuthorizationError("Missing permission: medication.approve");
  if (weekStartKey(input.weekStart) !== input.weekStart) throw new ValidationError("A week starts on a Monday");
  const { signature, onBehalf } = await resolveSigner(a, input.signerUserId, input.attestedInPerson, false);
  const key = { clientId_weekStart: { clientId, weekStart: dayKeyToDate(input.weekStart) } };
  await prisma.$transaction(async tx => {
    const existing = await tx.clientMedicationWeekSignoff.findUnique({ where: key });
    const data = { signerUserId: signature.userId, signerName: signature.typedName, appliedByUserId: a.userId, attestedInPerson: onBehalf ? input.attestedInPerson : false, signedAt: new Date() };
    const row = await tx.clientMedicationWeekSignoff.upsert({ where: key, create: { organizationId, clientId, weekStart: dayKeyToDate(input.weekStart), ...data }, update: data });
    await tx.clientMedicationHistory.create({ data: { organizationId, clientId, entityType: "WEEK_SIGNOFF", entityId: row.id, action: existing ? "REPLACED" : "ENTERED", changedByUserId: a.userId, snapshotJson: snapshot({ label: `Week of ${input.weekStart}`, ...(existing ? { before: existing } : {}), after: row }) } });
  });
  return { ok: true };
}
