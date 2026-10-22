import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { email: "Owner@Example.com", status: "ACTIVE" } as null | { email: string | null; status: string }, membership: { userId: "u1", status: "ACTIVE" } as null | { userId: string; status: string } }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: async () => state.user },
  organizationMembership: { findUnique: async () => state.membership },
  permission: { findMany: async () => [{ code: "organization.manage" }, { code: "medication.approve" }, { code: "billing.run" }] },
} }));

import { isMasterAccount, masterAccountEmails } from "@/domain/permissions/master-account";
import { resolvePermissionCodes } from "@/domain/permissions/authorization";

afterEach(() => { delete process.env.MASTER_ACCOUNT_EMAILS; state.user = { email: "Owner@Example.com", status: "ACTIVE" }; state.membership = { userId: "u1", status: "ACTIVE" }; });

describe("master account", () => {
  it("is off unless configured", async () => {
    expect(masterAccountEmails()).toEqual([]);
    expect(await isMasterAccount("u1")).toBe(false);
  });
  it("matches a configured sign-in email case-insensitively", async () => {
    process.env.MASTER_ACCOUNT_EMAILS = " owner@example.com , other@example.com";
    expect(await isMasterAccount("u1")).toBe(true);
  });
  it("does not match other emails, inactive users, or users without an email", async () => {
    process.env.MASTER_ACCOUNT_EMAILS = "someone@example.com";
    expect(await isMasterAccount("u1")).toBe(false);
    process.env.MASTER_ACCOUNT_EMAILS = "owner@example.com";
    state.user = { email: "owner@example.com", status: "SUSPENDED" }; expect(await isMasterAccount("u1")).toBe(false);
    state.user = { email: null, status: "ACTIVE" }; expect(await isMasterAccount("u1")).toBe(false);
  });
  it("grants every permission to an active master membership only", async () => {
    process.env.MASTER_ACCOUNT_EMAILS = "owner@example.com";
    expect([...(await resolvePermissionCodes("m1"))].sort()).toEqual(["billing.run", "medication.approve", "organization.manage"]);
    state.membership = { userId: "u1", status: "SUSPENDED" };
    await expect(resolvePermissionCodes("m1")).rejects.toThrow(); // falls through to normal resolution, which needs the real tables
  });
});
