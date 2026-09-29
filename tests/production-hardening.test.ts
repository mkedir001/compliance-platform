import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import nextConfig from "../next.config";
import { productionAuthSignature, requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { evidenceReferenceSchema } from "@/domain/evidence/reference";
import { claimEmployeePortalInvitation, inviteEmployeeToPortal } from "@/domain/portal/service";
import { HttpEmailProvider } from "@/domain/notifications/email";
import { requireEmployeeSelfAccess } from "@/domain/permissions/authorization";
import { GET as live } from "@/app/api/health/live/route";
import { GET as ready } from "@/app/api/health/ready/route";
import { POST as job } from "@/app/api/jobs/compliance/route";
import { validateProductionEnvironment } from "@/lib/env";
import { requireStoredEvidence } from "@/lib/evidence-storage";
import { enforceRateLimit, probeRateLimiter, requestRateKey, resetLocalRateLimits } from "@/lib/rate-limit";
import { assertDevelopmentSeedAllowed } from "../prisma/seed-guard";

const db = new PrismaClient();
const production = { PRODUCTION_AUTH_MODE: "trusted-proxy-hmac", APP_BASE_URL: "https://compliance.example.test", AUTH_PROXY_SECRET: "a".repeat(32), JOB_SECRET: "b".repeat(32), JOB_ACTOR_USER_ID: "actor", RATE_LIMIT_URL: "https://limits.example.test/check", RATE_LIMIT_TOKEN: "c".repeat(20), EVIDENCE_STORAGE_MODE: "external-reference", EVIDENCE_STORAGE_URL: "https://evidence.example.test/v1/evidence", EVIDENCE_STORAGE_TOKEN: "d".repeat(20) };
describe.sequential("Phase 23 production hardening", () => {
  let userId: string, ownerId: string, organizationId: string;
  beforeAll(async () => { const tag = `phase23-${Date.now()}`, user = await db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }), owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }), organization = await db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } }); userId = user.id; ownerId = owner.id; organizationId = organization.id; });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetLocalRateLimits(); });

  it("fails closed on incomplete production configuration without exposing values", () => {
    expect(() => validateProductionEnvironment({ DATABASE_URL: "postgresql://db.invalid/app", APP_BASE_URL: "http://insecure.test" })).toThrow();
    expect(validateProductionEnvironment({ DATABASE_URL: "postgresql://db.invalid/app", ...production })).toEqual(expect.objectContaining({ EVIDENCE_STORAGE_MODE: "external-reference" }));
  });

  it("accepts only fresh signed production identity assertions and rejects cross-site mutations", async () => {
    vi.stubEnv("NODE_ENV", "production"); for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL!);
    const timestamp = String(Date.now()), signature = productionAuthSignature(userId, timestamp, production.AUTH_PROXY_SECRET), headers = { "x-auth-user-id": userId, "x-auth-timestamp": timestamp, "x-auth-signature": signature };
    expect((await requireAuthenticatedUser(new Request("https://compliance.example.test/api", { headers }))).id).toBe(userId);
    await expect(requireAuthenticatedUser(new Request("https://compliance.example.test/api", { method: "POST", headers: { ...headers, origin: "https://evil.example" } }))).rejects.toThrow(/origin rejected/);
    await expect(requireAuthenticatedUser(new Request("https://compliance.example.test/api", { headers: { ...headers, "x-auth-signature": "0".repeat(64) } }))).rejects.toThrow(/invalid/);
  });

  it("applies production security headers", async () => {
    const entries = await nextConfig.headers!(); const headers = Object.fromEntries(entries[0].headers.map(item => [item.key, item.value]));
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'"); expect(headers["X-Content-Type-Options"]).toBe("nosniff"); expect(headers["Referrer-Policy"]).toBeTruthy(); expect(headers["Permissions-Policy"]).toBeTruthy();
  });

  it("sanitizes unexpected failures and validation details", async () => {
    const secret = "database-password-secret", response = errorResponse(new Error(secret)), body = await response.json();
    expect(response.status).toBe(500); expect(JSON.stringify(body)).not.toContain(secret); expect(body.requestId).toBeTruthy();
  });

  it("enforces local abuse bounds and approved evidence reference schemes", async () => {
    await enforceRateLimit("phase23-test", "actor", 2, 60); await enforceRateLimit("phase23-test", "actor", 2, 60); await expect(enforceRateLimit("phase23-test", "actor", 2, 60)).rejects.toThrow(/rate limit/);
    expect(evidenceReferenceSchema.parse("secure:opaque-reference")).toBe("secure:opaque-reference"); expect(() => evidenceReferenceSchema.parse("../../etc/passwd")).toThrow(); expect(() => evidenceReferenceSchema.parse("javascript:alert(1)")).toThrow();
    expect(requestRateKey(new Request("https://local", { headers: { "x-forwarded-for": "spoofed" } }), "actor")).toBe("actor");
  });

  it("reports liveness and database readiness without configuration secrets", async () => {
    const liveResponse = await live(), readyResponse = await ready(), body = await readyResponse.json(); expect((await liveResponse.json()).status).toBe("live"); expect(readyResponse.status).toBe(200); expect(body.status).toBe("ready"); expect(JSON.stringify(body)).not.toMatch(/postgresql:|AUTH_PROXY_SECRET|DATABASE_URL/);
  });

  it("includes required shared infrastructure in production readiness", async () => {
    vi.stubEnv("NODE_ENV", "production"); for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL!);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ allowed: true, ok: true }) }); vi.stubGlobal("fetch", fetchMock);
    const healthy = await ready(); expect(healthy.status).toBe(200); expect(await healthy.json()).toEqual(expect.objectContaining({ rateLimiter: "available", evidenceStorage: "available" }));
    fetchMock.mockRejectedValueOnce(new Error("backend unavailable")); const unavailable = await ready(); expect(unavailable.status).toBe(503); expect(JSON.stringify(await unavailable.json())).not.toContain(production.RATE_LIMIT_TOKEN);
  });

  it("expands notification actions against the canonical HTTPS application URL", async () => {
    vi.stubEnv("APP_BASE_URL", production.APP_BASE_URL); const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "message-1" }) }); vi.stubGlobal("fetch", fetchMock);
    await new HttpEmailProvider({ apiUrl: "https://email.example.test/send", apiToken: "token", from: "compliance@example.test" }).send({ to: "worker@example.test", subject: "Action", text: "Review", actionHref: "/learn?tab=evidence" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).actionHref).toBe("https://compliance.example.test/learn?tab=evidence");
  });

  it("fails closed through shared rate-limit and tenant-scoped evidence gateways", async () => {
    vi.stubEnv("NODE_ENV", "production"); for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL!);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ allowed: true, ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeRateLimiter()).resolves.toBe(true);
    await expect(requireStoredEvidence(organizationId, "secure:tenant-object")).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ operation: "verify", organizationId, reference: "secure:tenant-object" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(requireStoredEvidence(organizationId, "secure:unavailable")).rejects.toThrow(/not recorded/);
  });

  it("denies inactive workforce self-access and expired invitation claims", async () => {
    const tag = `lifecycle-${Date.now()}`, account = await db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }); await db.organizationMembership.create({ data: { organizationId, userId: account.id, status: "ACTIVE" } }); const employee = await db.employee.create({ data: { organizationId, userId: account.id, email: account.email, firstName: "Inactive", lastName: "Worker", employmentStatus: "ACTIVE" } });
    expect((await requireEmployeeSelfAccess(account, organizationId, employee.id)).id).toBe(employee.id); await db.employee.update({ where: { id: employee.id }, data: { employmentStatus: "TERMINATED" } }); await expect(requireEmployeeSelfAccess(account, organizationId, employee.id)).rejects.toThrow(/denied/);
    const invitee = await db.employee.create({ data: { organizationId, email: `invite-${tag}@example.test`, firstName: "Invite", lastName: "Expired", employmentStatus: "PENDING" } }), invited = await inviteEmployeeToPortal({ id: ownerId }, organizationId, invitee.id); await db.employeePortalInvitation.update({ where: { id: invited.invitation.id }, data: { invitedAt: new Date(Date.now() - 8 * 86400000) } }); const invitedUser = await db.user.findUniqueOrThrow({ where: { email: invitee.email! } }); await expect(claimEmployeePortalInvitation(invitedUser, organizationId, invited.claimToken)).rejects.toThrow(/expired/);
  });

  it("requires the explicit job secret before tenant work", async () => {
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL!);
    const response = await job(new Request("http://local/api/jobs/compliance", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: JSON.stringify({ organizationId }) }));
    expect(response.status).toBe(401); expect(JSON.stringify(await response.json())).not.toContain(production.JOB_SECRET);
  });

  it("runs authenticated tenant jobs idempotently without requiring outbound email", async () => {
    for (const [key, value] of Object.entries({ ...production, JOB_ACTOR_USER_ID: ownerId })) vi.stubEnv(key, value); vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL!);
    const invoke = () => job(new Request("http://local/api/jobs/compliance", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${production.JOB_SECRET}` }, body: JSON.stringify({ organizationId }) }));
    const first = await invoke(); expect(first.status).toBe(200); const issueCount = await db.complianceIssue.count({ where: { organizationId } }), notificationCount = await db.notification.count({ where: { organizationId } });
    const second = await invoke(); expect(second.status).toBe(200); expect(await db.complianceIssue.count({ where: { organizationId } })).toBe(issueCount); expect(await db.notification.count({ where: { organizationId } })).toBe(notificationCount); expect((await second.json()).email.processed).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("prevents production demo seeding", () => { expect(() => assertDevelopmentSeedAllowed("production")).toThrow(/disabled in production/); expect(() => assertDevelopmentSeedAllowed("test")).not.toThrow(); });
});
