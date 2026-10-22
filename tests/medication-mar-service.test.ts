import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayKey } from "@/domain/clients/mar";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(), client: true, employee: true, assignment: true, eligible: true, medApproved: true, clinicalCredential: false,
  medicationTimes: "8 AM" as string | null, medicationStartDate: new Date("2020-01-01T00:00:00.000Z") as Date | null, medicationStopDate: null as Date | null,
  signatures: [] as { userId: string; typedName: string; initials: string }[], dose: null as null | Record<string, unknown>,
  created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[],
}));

vi.mock("@/domain/permissions/authorization", () => ({
  requireOrganizationAccess: async () => ({ organization: { timezone: "America/Chicago" }, membership: { id: "mem" } }),
  resolvePermissionCodes: async () => state.permissions,
}));
vi.mock("@/domain/medication/service", () => ({ computeMedicationDutyEligibility: async () => ({ eligible: state.eligible, reasonCodes: state.eligible ? [] : ["AUTHORIZATION_REQUIRED"] }) }));
vi.mock("@/lib/prisma", () => {
  const doseApi = {
    findUnique: async () => state.dose,
    findUniqueOrThrow: async () => state.dose,
    create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: "dose1", createdAt: new Date(), updatedAt: new Date(), ...data }; state.dose = row; state.writes.push(row); return row; },
    updateMany: async ({ data }: { data: Record<string, unknown> }) => { if (!state.dose) return { count: 0 }; state.dose = { ...state.dose, ...data, updatedAt: new Date("2026-10-21T18:00:00.000Z") }; state.writes.push(data); return { count: 1 }; },
  };
  const tx = {
    clientMedicationDose: doseApi,
    clientMedication: {
      create: async ({ data }: { data: Record<string, unknown> }) => { state.created.push(data); return { id: "ckmedication0000000000002", medication: String(data.medication), ...data }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { state.updated.push(data); return { id: "ckmedication0000000000001", medication: "Lamotrigine", ...data }; },
    },
    clientMedicationHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { state.history.push(data); return data; } },
    auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return data; } },
  };
  return { prisma: {
    client: { findFirst: async () => state.client ? { id: "c1" } : null },
    employee: { findFirst: async () => state.employee ? { id: "employee1" } : null },
    professionalCredential: { findFirst: async () => state.clinicalCredential ? { id: "credential1" } : null },
    serviceAssignment: { findFirst: async ({ where }: { where: { blockingScope?: string } }) => where.blockingScope ? (state.assignment ? { id: "assignment1", medicationPathwayId: "pathway1" } : null) : { id: "assigned-client" } },
    clientMedication: { findFirst: async () => ({ id: "ckmedication0000000000001", medication: "Lamotrigine", dose: null, route: null, times: state.medicationTimes, reason: null, prescriber: null, startDate: state.medicationStartDate, stopDate: state.medicationStopDate, marApprovedAt: state.medApproved ? new Date() : null, marApprovedByUserId: state.medApproved ? "clinical-user" : null }) },
    medicationStaffSignature: {
      findUnique: async ({ where }: { where: { organizationId_userId: { userId: string } } }) => state.signatures.find(s => s.userId === where.organizationId_userId.userId) ?? null,
      findMany: async () => state.signatures,
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } };
});

import { applyMedicationAction } from "@/domain/clients/medication-mar";

const userId = "cjstaff0000000000000001", med = "ckmedication0000000000001";
const today = () => todayKey(new Date(), "America/Chicago");
const dose = (extra: Record<string, unknown> = {}) => ({ action: "SAVE_DOSE", medicationId: med, doseDate: today(), scheduledTime: "08:00", status: "GIVEN", timeGiven: "08:03", ...extra });
const call = (body: unknown) => applyMedicationAction({ id: userId }, "org1", "c1", body);

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T18:00:00.000Z"));
  state.permissions = new Set(["medication.activity.record"]); state.client = true; state.employee = true; state.assignment = true; state.eligible = true; state.medApproved = true; state.clinicalCredential = false;
  state.medicationTimes = "8 AM"; state.medicationStartDate = new Date("2020-01-01T00:00:00.000Z"); state.medicationStopDate = null;
  state.signatures = [{ userId, typedName: "Amina Bashir", initials: "AB" }]; state.dose = null; state.history = []; state.audits = []; state.writes = []; state.created = []; state.updated = [];
});
afterAll(() => vi.useRealTimers());

describe("MAR service safety rules", () => {
  it("records only the authenticated assigned and currently eligible employee", async () => {
    await call(dose());
    expect(state.writes[0]).toMatchObject({ signerUserId: userId, signerInitials: "AB", appliedByUserId: userId, status: "GIVEN" });
    expect(state.history[0]).toMatchObject({ entityType: "DOSE", action: "ENTERED" });
    expect(state.audits[0]).toMatchObject({ eventType: "client.medication_entered" });
  });
  it("denies a recorder without an active client medication assignment", async () => {
    state.assignment = false;
    await expect(call(dose())).rejects.toThrow(/active medication-administration assignment/);
  });
  it("denies a recorder whose current medication governance is blocked", async () => {
    state.eligible = false;
    await expect(call(dose())).rejects.toThrow(/AUTHORIZATION_REQUIRED/);
  });
  it("does not let broad client access grant administration authority", async () => {
    state.permissions = new Set(["client.read", "client.update"]);
    await expect(call(dose())).rejects.toThrow(/Assigned-client medication access/);
  });
  it("does not turn imported medication information into an approved MAR schedule", async () => {
    state.medApproved = false;
    await expect(call(dose())).rejects.toThrow(/explicitly approved for MAR/);
  });
  it("does not let an owner-level permission bypass the verified clinical credential for MAR approval", async () => {
    state.permissions = new Set(["organization.manage", "medication.approve"]); state.medApproved = false;
    await expect(call({ action: "SAVE_MEDICATION", medication: "Synthetic medication", dose: "1 unit", times: "8 AM" })).resolves.toMatchObject({ ok: true });
    expect(state.created.at(-1)).toMatchObject({ marApprovedAt: null, marApprovedByUserId: null });
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).rejects.toThrow(/clinical reviewer/);
  });
  it("rejects impersonation and transferred-paper fields", async () => {
    await expect(call(dose({ signerUserId: "cjboss00000000000000001", transferredFromPaper: true }))).rejects.toThrow(/Unrecognized key/);
  });
  it("requires explanatory notes for refused, held, and missed doses", async () => {
    await expect(call(dose({ status: "REFUSED", timeGiven: null }))).rejects.toThrow(/note is required/);
    await call(dose({ status: "HELD", timeGiven: null, note: "Held under current instructions" }));
    expect(state.writes[0]).toMatchObject({ status: "HELD", timeGiven: null });
  });
  it("requires a reason for late entry and limits online backdating", async () => {
    await expect(call(dose({ doseDate: addDays(today(), -1) }))).rejects.toThrow(/late-entry reason/);
    await expect(call(dose({ doseDate: addDays(today(), -8), lateEntryReason: "Paper record entered later" }))).rejects.toThrow(/prior seven days/);
  });
  it("requires a reason and current version token for corrections", async () => {
    state.dose = { id: "dose1", status: "REFUSED", updatedAt: new Date("2026-10-21T17:00:00.000Z"), signerName: "Amina Bashir" };
    await expect(call(dose())).rejects.toThrow(/correction reason/);
    await expect(call(dose({ correctionReason: "Correcting documentation after review", expectedUpdatedAt: "2026-10-21T16:00:00.000Z" }))).rejects.toThrow(/changed after it was opened/);
    await call(dose({ correctionReason: "Correcting documentation after review", expectedUpdatedAt: "2026-10-21T17:00:00.000Z" }));
    expect(state.history.at(-1)).toMatchObject({ action: "CORRECTED" });
    expect((state.history.at(-1)?.snapshotJson as { before: { status: string } }).before.status).toBe("REFUSED");
  });
  it("does not accept future dates or unstructured/PRN schedule slots", async () => {
    await expect(call(dose({ doseDate: addDays(today(), 1) }))).rejects.toThrow(/future/);
    await expect(call(dose({ timeGiven: "14:00" }))).rejects.toThrow(/Time given cannot be in the future/);
    await expect(call(dose({ scheduledTime: "00:00" }))).rejects.toThrow(/not in the current medication schedule/);
  });
  it("fails closed for a client outside the organization", async () => {
    state.client = false;
    await expect(call(dose())).rejects.toThrow(/Client not found/);
  });
});

describe("Pending medication approval", () => {
  const manager = () => { state.permissions = new Set(["organization.manage", "medication.approve"]); state.clinicalCredential = false; };
  it("lets an organization manager add a medication that stays unapproved", async () => {
    manager();
    await expect(call({ action: "SAVE_MEDICATION", medication: "Synthetic medication", dose: "1 unit", times: "8 AM" })).resolves.toMatchObject({ ok: true });
    expect(state.created.at(-1)).toMatchObject({ marApprovedAt: null, marApprovedByUserId: null });
  });
  it("requires a separate explicit approval even when a clinical reviewer enters the medication", async () => {
    manager(); state.clinicalCredential = true;
    await call({ action: "SAVE_MEDICATION", medication: "Synthetic medication", times: "8 AM" });
    expect(state.created.at(-1)).toMatchObject({ marApprovedAt: null, marApprovedByUserId: null });
  });
  it("refuses medication entry from someone who is neither a manager nor a reviewer", async () => {
    state.permissions = new Set(["medication.assigned.read"]);
    await expect(call({ action: "SAVE_MEDICATION", medication: "Synthetic medication" })).rejects.toThrow();
  });
  it("only a clinical reviewer can approve", async () => {
    manager(); state.medApproved = false;
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).rejects.toThrow(/clinical reviewer/);
    state.clinicalCredential = true;
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).resolves.toMatchObject({ ok: true });
    expect(state.updated.at(-1)).toMatchObject({ marApprovedByUserId: userId });
    expect(state.history.at(-1)).toMatchObject({ action: "APPROVED" });
  });
  it("requires a dated, structured, currently relevant order before approval", async () => {
    manager(); state.medApproved = false; state.clinicalCredential = true; state.medicationStartDate = null;
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).rejects.toThrow(/start date/);
    state.medicationStartDate = new Date("2020-01-01T00:00:00.000Z"); state.medicationTimes = "PRN";
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).rejects.toThrow(/structured medication schedule/);
    state.medicationTimes = "8 AM"; state.medicationStopDate = new Date("2026-10-20T00:00:00.000Z");
    await expect(call({ action: "APPROVE_MEDICATION", id: med })).rejects.toThrow(/ended medication/);
  });
  it("invalidates approval after a substantive edit, including an edit by a reviewer", async () => {
    manager(); state.clinicalCredential = true;
    await call({ action: "SAVE_MEDICATION", id: med, medication: "Lamotrigine", dose: "100 mg", times: "8 AM", startDate: "2020-01-01" });
    expect(state.updated.at(-1)).toMatchObject({ marApprovedAt: null, marApprovedByUserId: null });
  });
  it("preserves approval when an approved medication is discontinued without changing the order", async () => {
    manager();
    await call({ action: "SAVE_MEDICATION", id: med, medication: "Lamotrigine", times: "8 AM", startDate: "2020-01-01", stopDate: "2026-10-21" });
    expect(state.updated.at(-1)).not.toHaveProperty("marApprovedAt");
    expect(state.history.at(-1)).toMatchObject({ action: "DISCONTINUED" });
  });
});
