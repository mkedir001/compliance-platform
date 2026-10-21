import { beforeEach, describe, expect, it, vi } from "vitest";

const record = { payload: { id: 7, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-05-01", status: { active: true } }, removedAt: null, ignoredAt: null };
const prisma = { axisCareRecord: { findUnique: vi.fn() }, client: { findFirst: vi.fn() } };
const createClient = vi.fn(), confirmExplicitClientMatch = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/domain/clients/service", () => ({ createClient }));
vi.mock("@/domain/axiscare/sync", () => ({ confirmExplicitClientMatch }));

const { createClientFromAxisCare } = await import("@/domain/axiscare/create-client");

describe("createClientFromAxisCare", () => {
  beforeEach(() => { vi.clearAllMocks(); prisma.axisCareRecord.findUnique.mockResolvedValue(record); prisma.client.findFirst.mockResolvedValue(null); createClient.mockResolvedValue({ client: { id: "c1" } }); confirmExplicitClientMatch.mockResolvedValue("c1"); });
  it("creates from name and date of birth only, then links", async () => {
    expect(await createClientFromAxisCare({ id: "u" }, "org", "7")).toBe("c1");
    expect(createClient).toHaveBeenCalledWith({ id: "u" }, "org", { legalFirstName: "Ada", legalLastName: "Lovelace", dateOfBirth: "1990-05-01" });
    expect(confirmExplicitClientMatch).toHaveBeenCalledWith("org", "7", "c1", "u");
  });
  it("refuses an already matched AxisCare client", async () => { prisma.client.findFirst.mockResolvedValue({ id: "x" }); await expect(createClientFromAxisCare({ id: "u" }, "org", "7")).rejects.toThrow(/already matched/); expect(createClient).not.toHaveBeenCalled(); });
  it("refuses an ignored or missing source", async () => { prisma.axisCareRecord.findUnique.mockResolvedValue({ ...record, ignoredAt: new Date() }); await expect(createClientFromAxisCare({ id: "u" }, "org", "7")).rejects.toThrow(/not found/); });
  it("needs a first and last name", async () => { prisma.axisCareRecord.findUnique.mockResolvedValue({ ...record, payload: { id: 7, firstName: "Ada" } }); await expect(createClientFromAxisCare({ id: "u" }, "org", "7")).rejects.toThrow(/first and last name/); });
  it("creates without a date of birth when AxisCare has none", async () => { prisma.axisCareRecord.findUnique.mockResolvedValue({ ...record, payload: { id: 7, firstName: "Ada", lastName: "Lovelace" } }); await createClientFromAxisCare({ id: "u" }, "org", "7"); expect(createClient.mock.calls[0][2].dateOfBirth).toBeUndefined(); });
});
