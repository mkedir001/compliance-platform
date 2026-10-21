import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), signatures: [] as { userId: string; typedName: string; initials: string }[], dose: null as null | Record<string, unknown>, history: [] as Record<string, unknown>[], upserts: [] as Record<string, unknown>[] }));

vi.mock("@/domain/permissions/authorization", () => ({
  requireOrganizationAccess: async () => ({ membership: { id: "mem" } }),
  resolvePermissionCodes: async () => state.permissions,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    clientMedicationDose: {
      findUnique: async () => state.dose,
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => { state.upserts.push(state.dose ? args.update : args.create); return { id: "dose1", ...(state.dose ?? args.create), ...args.update }; },
    },
    clientMedicationHistory: { create: async (args: { data: Record<string, unknown> }) => { state.history.push(args.data); return args.data; } },
  };
  return { prisma: {
    client: { findFirst: async () => ({ id: "c1" }) },
    clientMedication: { findFirst: async () => ({ id: "ckmedication0000000000001", medication: "Lamotrigine" }) },
    medicationStaffSignature: { findUnique: async ({ where }: { where: { organizationId_userId: { userId: string } } }) => state.signatures.find(s => s.userId === where.organizationId_userId.userId) ?? null },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } };
});

import { applyMedicationAction } from "@/domain/clients/medication-mar";

const med = "ckmedication0000000000001";
const dose = (extra: Record<string, unknown> = {}) => ({ action: "SAVE_DOSE", medicationId: med, doseDate: "2026-09-12", scheduledTime: "08:00", status: "GIVEN", ...extra });
const call = (userId: string, body: unknown) => applyMedicationAction({ id: userId }, "org1", "c1", body);

beforeEach(() => {
  state.permissions = new Set(["medication.activity.record"]);
  state.signatures = [{ userId: "cjstaff0000000000000001", typedName: "Amina Bashir", initials: "AB" }, { userId: "cjboss00000000000000001", typedName: "Dana Okafor", initials: "DO" }];
  state.dose = null; state.history = []; state.upserts = [];
});

describe("MAR service rules", () => {
  it("records a past-dated dose keyed to the day it was due and logs the entry", async () => {
    await call("cjstaff0000000000000001", dose());
    expect(state.upserts[0]).toMatchObject({ doseDate: new Date("2026-09-12T00:00:00.000Z"), scheduledTime: "08:00", signerInitials: "AB", appliedByUserId: "cjstaff0000000000000001" });
    expect(state.history[0]).toMatchObject({ entityType: "DOSE", action: "ENTERED" });
  });
  it("replaces an existing entry in place and keeps the earlier version only in history", async () => {
    state.dose = { id: "dose1", status: "REFUSED", signerName: "Amina Bashir" };
    await call("cjstaff0000000000000001", dose({ status: "GIVEN" }));
    expect(state.history[0]).toMatchObject({ action: "REPLACED" });
    expect((state.history[0].snapshotJson as { before: { status: string } }).before.status).toBe("REFUSED");
  });
  it("refuses a future date", async () => {
    await expect(call("cjstaff0000000000000001", dose({ doseDate: "2999-01-01" }))).rejects.toThrow(/future/);
  });
  it("requires the signer to have set up a signature", async () => {
    await expect(call("cjnewbie000000000000001", dose())).rejects.toThrow(/Set up your signature/);
  });
  it("lets only an administrator sign for someone else, and only with an attestation", async () => {
    await expect(call("cjstaff0000000000000001", dose({ signerUserId: "cjboss00000000000000001" }))).rejects.toThrow(/administrator/);
    state.permissions = new Set(["organization.manage"]);
    await expect(call("cjboss00000000000000001", dose({ signerUserId: "cjstaff0000000000000001" }))).rejects.toThrow(/attested/);
    await call("cjboss00000000000000001", dose({ signerUserId: "cjstaff0000000000000001", attestedInPerson: true }));
    expect(state.upserts.at(-1)).toMatchObject({ signerUserId: "cjstaff0000000000000001", signerInitials: "AB", appliedByUserId: "cjboss00000000000000001", attestedInPerson: true });
  });
  it("blocks recording without the recording permission", async () => {
    state.permissions = new Set(["client.read"]);
    await expect(call("cjstaff0000000000000001", dose())).rejects.toThrow(/medication.activity.record/);
  });
  it("only lets reviewers sign a week, and only on a Monday", async () => {
    await expect(call("cjstaff0000000000000001", { action: "SIGN_WEEK", weekStart: "2026-10-12" })).rejects.toThrow(/medication.approve/);
    state.permissions = new Set(["organization.manage"]);
    await expect(call("cjboss00000000000000001", { action: "SIGN_WEEK", weekStart: "2026-10-13" })).rejects.toThrow(/Monday/);
  });
});
