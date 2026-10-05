import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createClaimContinuation, readClaimContinuation } from "@/domain/auth/claim-continuation";
import { resolveAuthenticatedLanding } from "@/domain/auth/landing";
import { claimEmployeePortalInvitationByIdentity, inspectEmployeePortalInvitation, inviteEmployeeToPortal } from "@/domain/portal/service";
import { GET as resumeClaim } from "@/app/learn/claim/resume/route";

const db = new PrismaClient();
const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

describe.sequential("employee invitation claim onboarding", () => {
  let ownerId: string, organizationId: string;
  beforeAll(async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }), organization = await db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } });
    ownerId = owner.id; organizationId = organization.id;
  });

  async function invitation(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, employee = await db.employee.create({ data: { organizationId, email, firstName: "Invited", lastName: "Employee", employmentStatus: "PENDING" } }), invited = await inviteEmployeeToPortal({ id: ownerId }, organizationId, employee.id);
    return { email, employee, ...invited };
  }

  it("keeps a valid first-time invitation public-safe until a verified identity claims it", async () => {
    const created = await invitation("first-time");
    expect(await inspectEmployeePortalInvitation(created.claimToken)).toEqual({ state: "VALID" });
    const before = await db.user.findUniqueOrThrow({ where: { email: created.email } });
    expect(before).toMatchObject({ status: "INVITED", authProviderUserId: null });
    expect((await db.employee.findUniqueOrThrow({ where: { id: created.employee.id } })).userId).toBeNull();
    const result = await claimEmployeePortalInvitationByIdentity({ subject: `${created.employee.id}-subject`, email: created.email.toUpperCase(), emailVerified: true }, created.claimToken);
    expect(result).toMatchObject({ status: "ACCEPTED", employeeId: created.employee.id, organizationId, destination: `/learn?organizationId=${encodeURIComponent(organizationId)}` });
    const [account, employee, membership, stored] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: created.email } }), db.employee.findUniqueOrThrow({ where: { id: created.employee.id } }), db.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: before.id } }, include: { roles: true } }), db.employeePortalInvitation.findUniqueOrThrow({ where: { tokenHash: tokenDigest(created.claimToken) } }),
    ]);
    expect(account).toMatchObject({ status: "ACTIVE", authProviderUserId: `${created.employee.id}-subject` });
    expect(employee.userId).toBe(account.id); expect(membership.status).toBe("ACTIVE"); expect(membership.roles).toHaveLength(0); expect(stored).toMatchObject({ status: "ACCEPTED", acceptedByUserId: account.id });
    expect((await resolveAuthenticatedLanding(account.id)).map(item => item.experience)).toEqual(["employee"]);
    expect(JSON.stringify(await db.auditEvent.findMany({ where: { entityId: { in: [account.id, stored.id] } } }))).not.toContain(created.claimToken);
  });

  it("does not let an authenticated organization owner claim an employee invitation", async () => {
    const created = await invitation("wrong-owner"), owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    await expect(claimEmployeePortalInvitationByIdentity({ subject: owner.authProviderUserId ?? "owner-subject", email: owner.email!, emailVerified: true }, created.claimToken)).rejects.toMatchObject({ code: "INVITATION_ACCOUNT_MISMATCH" });
    const [employee, stored] = await Promise.all([db.employee.findUniqueOrThrow({ where: { id: created.employee.id } }), db.employeePortalInvitation.findUniqueOrThrow({ where: { tokenHash: tokenDigest(created.claimToken) } })]);
    expect(employee.userId).toBeNull(); expect(stored.status).toBe("PENDING"); expect(stored.acceptedByUserId).toBeNull();
  });

  it("links an existing correct account without duplication and rejects replay", async () => {
    const tag = `existing-${Date.now()}-${Math.random().toString(36).slice(2)}`, email = `${tag}@example.test`, subject = `${tag}-subject`, account = await db.user.create({ data: { email, status: "ACTIVE", authProviderUserId: subject } }), employee = await db.employee.create({ data: { organizationId, email, firstName: "Existing", lastName: "Account", employmentStatus: "ACTIVE" } }), invited = await inviteEmployeeToPortal({ id: ownerId }, organizationId, employee.id);
    await claimEmployeePortalInvitationByIdentity({ subject, email, emailVerified: true }, invited.claimToken);
    const userCount = await db.user.count({ where: { email } }), claimAuditCount = await db.auditEvent.count({ where: { entityId: invited.invitation.id, eventType: "employee.portal_invitation_claimed" } });
    await expect(claimEmployeePortalInvitationByIdentity({ subject, email, emailVerified: true }, invited.claimToken)).rejects.toMatchObject({ code: "INVITATION_ALREADY_CLAIMED" });
    expect(await db.user.count({ where: { email } })).toBe(userCount); expect(await db.auditEvent.count({ where: { entityId: invited.invitation.id, eventType: "employee.portal_invitation_claimed" } })).toBe(claimAuditCount); expect((await db.employee.findUniqueOrThrow({ where: { id: employee.id } })).userId).toBe(account.id);
  });

  it("distinguishes expired, revoked, and superseded invitations without exposing a recipient", async () => {
    const expired = await invitation("expired"); await db.employeePortalInvitation.update({ where: { id: expired.invitation.id }, data: { invitedAt: new Date(Date.now() - 8 * 86400000) } });
    expect(await inspectEmployeePortalInvitation(expired.claimToken)).toEqual({ state: "EXPIRED" });
    await expect(claimEmployeePortalInvitationByIdentity({ subject: "expired-subject", email: expired.email, emailVerified: true }, expired.claimToken)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    const revoked = await invitation("revoked"); await db.employeePortalInvitation.update({ where: { id: revoked.invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    expect(await inspectEmployeePortalInvitation(revoked.claimToken)).toEqual({ state: "REVOKED" });
    const superseded = await invitation("superseded"), replacement = await inviteEmployeeToPortal({ id: ownerId }, organizationId, superseded.employee.id);
    expect(await inspectEmployeePortalInvitation(superseded.claimToken)).toEqual({ state: "SUPERSEDED" }); expect(await inspectEmployeePortalInvitation(replacement.claimToken)).toEqual({ state: "VALID" });
  });

  it("encrypts short-lived claim continuation state and safely resumes after sign-out", async () => {
    vi.stubEnv("JOB_SECRET", "j".repeat(32)); const token = "t".repeat(43), value = createClaimContinuation(token, 1000);
    expect(value).not.toContain(token); expect(readClaimContinuation(value, 2000)).toBe(token); expect(readClaimContinuation(`${value}tampered`, 2000)).toBeNull(); expect(readClaimContinuation(value, 1000 + 11 * 60 * 1000)).toBeNull();
    const current = Date.now(), live = createClaimContinuation(token, current), response = await resumeClaim(new Request("https://app.waldah.com/learn/claim/resume", { headers: { cookie: `employee_claim_continuation=${live}` } }));
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe(`https://app.waldah.com/claim-auth/${token}`); expect(response.headers.get("set-cookie")).toContain("Max-Age=0"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); vi.unstubAllEnvs();
  });
});
