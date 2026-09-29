import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Fetcher } from "aws-jwt-verify/https";
import { createAlbAssertionVerifier, requireAuthenticatedUser } from "@/domain/auth/authentication";
import { linkCognitoIdentity } from "@/domain/auth/linkage";
import { requireOrganizationAccess } from "@/domain/permissions/authorization";
import { validateProductionEnvironment } from "@/lib/env";
import { GET as readiness } from "@/app/api/health/ready/route";

const db = new PrismaClient();
const signerArn = "arn:aws:elasticloadbalancing:us-east-2:123456789012:loadbalancer/app/compliance-production/0123456789abcdef";
const issuer = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_example";
const clientId = "production-client-id";
const keyId = "12345678-1234-1234-1234-123456789012";
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
let activeSubject = "subject-active", inactiveSubject = "subject-inactive";
let activeEmail = "active@example.test";
const production = {
  DATABASE_URL: process.env.DATABASE_URL!, APP_BASE_URL: "https://app.waldah.com", PRODUCTION_AUTH_MODE: "aws-alb-cognito",
  AWS_ALB_AUTH_SIGNER_ARN: signerArn, AWS_ALB_AUTH_ISSUER: issuer, AWS_ALB_AUTH_CLIENT_ID: clientId,
  JOB_SECRET: "j".repeat(32), JOB_ACTOR_USER_ID: "actor", RATE_LIMIT_URL: "https://rate.example.test/rate-limit", RATE_LIMIT_TOKEN: "r".repeat(20),
  EVIDENCE_STORAGE_MODE: "external-reference", EVIDENCE_STORAGE_URL: "https://evidence.example.test/evidence", EVIDENCE_STORAGE_TOKEN: "e".repeat(20),
} as const;

function encoded(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function assertion(subject = activeSubject, overrides: { header?: Record<string, unknown>; payload?: Record<string, unknown>; corrupt?: boolean } = {}) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const header = { alg: "ES256", kid: keyId, signer: signerArn, iss: issuer, client: clientId, exp, ...overrides.header };
  const payload = { sub: subject, email: "authenticated@example.test", iss: issuer, exp, ...overrides.payload };
  const signingInput = `${encoded(header)}.${encoded(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${signingInput}.${overrides.corrupt ? `${signature.slice(0, -2)}aa` : signature}`;
}
function configureProduction() { vi.stubEnv("NODE_ENV", "production"); for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); }
function mockFetcher(fail = false) {
  const fetch = vi.fn(async (uri: string) => {
    expect(uri).toBe(`https://public-keys.auth.elb.us-east-2.amazonaws.com/${keyId}`);
    if (fail) throw new Error("key service unavailable");
    return new TextEncoder().encode(publicKey).buffer;
  });
  return { fetch } satisfies Fetcher;
}
function verifier(fetcher = mockFetcher()) { const config = validateProductionEnvironment(production); if (config.PRODUCTION_AUTH_MODE !== "aws-alb-cognito") throw new Error("Invalid test configuration"); return createAlbAssertionVerifier(config, fetcher); }
function request(token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); if (token) headers.set("x-amzn-oidc-data", token);
  return new Request("https://app.waldah.com/api/organizations", { ...init, headers });
}

describe.sequential("AWS ALB Cognito authentication", () => {
  let activeUserId: string, inactiveUserId: string, organizationId: string, otherOrganizationId: string;
  beforeAll(async () => {
    const tag = `alb-auth-${Date.now()}`;
    activeSubject = `${tag}-active-subject`; inactiveSubject = `${tag}-inactive-subject`;
    activeEmail = `${tag}@example.test`;
    const [organization, otherOrganization] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
    ]);
    const [active, inactive] = await Promise.all([
      db.user.create({ data: { email: activeEmail, status: "ACTIVE", authProviderUserId: activeSubject } }),
      db.user.create({ data: { email: `${tag}-inactive@example.test`, status: "SUSPENDED", authProviderUserId: inactiveSubject } }),
    ]);
    await db.organizationMembership.create({ data: { organizationId: organization.id, userId: active.id, status: "ACTIVE" } });
    activeUserId = active.id; inactiveUserId = inactive.id; organizationId = organization.id; otherOrganizationId = otherOrganization.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("authenticates a mapped active user from a valid ALB-signed assertion and caches the key", async () => {
    configureProduction(); const fetcher = mockFetcher(), trusted = verifier(fetcher);
    expect((await requireAuthenticatedUser(request(assertion()), { albVerifier: trusted })).id).toBe(activeUserId);
    expect((await requireAuthenticatedUser(request(assertion()), { albVerifier: trusted })).id).toBe(activeUserId);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects an invalid signature", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion(activeSubject, { corrupt: true })), { albVerifier: verifier() })).rejects.toThrow(/assertion invalid/); });
  it("rejects a malformed JWT", async () => { configureProduction(); await expect(requireAuthenticatedUser(request("not-a-jwt"), { albVerifier: verifier() })).rejects.toThrow(/assertion invalid/); });
  it("rejects an expired assertion", async () => { configureProduction(); const exp = Math.floor(Date.now() / 1000) - 1; await expect(requireAuthenticatedUser(request(assertion(activeSubject, { header: { exp }, payload: { exp } })), { albVerifier: verifier() })).rejects.toThrow(/assertion invalid/); });
  it("rejects an unexpected ALB signer", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion(activeSubject, { header: { signer: "arn:aws:elasticloadbalancing:us-east-2:999999999999:loadbalancer/app/other/abcdef0123456789" } })), { albVerifier: verifier() })).rejects.toThrow(/assertion invalid/); });
  it("rejects a missing stable subject claim", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion(activeSubject, { payload: { sub: undefined } })), { albVerifier: verifier() })).rejects.toThrow(/assertion invalid/); });
  it("rejects an unknown Cognito subject even when its email matches an active user", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion("unknown-subject", { payload: { email: activeEmail } })), { albVerifier: verifier() })).rejects.toThrow(/Active user not found/); });
  it("rejects an inactive mapped internal user", async () => { configureProduction(); expect(inactiveUserId).toBeTruthy(); await expect(requireAuthenticatedUser(request(assertion(inactiveSubject)), { albVerifier: verifier() })).rejects.toThrow(/Active user not found/); });
  it("does not trust spoofed unsigned ALB identity headers", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(undefined, { headers: { "x-amzn-oidc-identity": activeSubject } }), { albVerifier: verifier() })).rejects.toThrow(/Authentication required/); });
  it("fails closed when the ALB public key cannot be retrieved", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion()), { albVerifier: verifier(mockFetcher(true)) })).rejects.toThrow(/assertion invalid/); });
  it("preserves tenant isolation after authentication", async () => { configureProduction(); const user = await requireAuthenticatedUser(request(assertion()), { albVerifier: verifier() }); expect((await requireOrganizationAccess(user, organizationId)).organization.id).toBe(organizationId); await expect(requireOrganizationAccess(user, otherOrganizationId)).rejects.toThrow(/denied/); });
  it("never falls back to development identity in production", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(undefined, { headers: { "x-dev-user-id": activeUserId } }), { albVerifier: verifier() })).rejects.toThrow(/Authentication required/); });
  it("preserves state-changing origin validation", async () => { configureProduction(); await expect(requireAuthenticatedUser(request(assertion(), { method: "POST", headers: { origin: "https://evil.example" } }), { albVerifier: verifier() })).rejects.toThrow(/origin rejected/); });
  it("keeps readiness callable without an end-user assertion", async () => { vi.stubEnv("NODE_ENV", "test"); expect((await readiness()).status).toBe(200); });

  it("links a first administrator once, audits it, and handles an identical retry idempotently", async () => {
    const tag = `link-${Date.now()}`, user = await db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } });
    await db.organizationMembership.create({ data: { organizationId, userId: user.id, status: "ACTIVE" } });
    expect((await linkCognitoIdentity({ email: user.email!, subject: `${tag}-subject` })).status).toBe("linked");
    expect((await linkCognitoIdentity({ userId: user.id, subject: `${tag}-subject` })).status).toBe("already-linked");
    expect(await db.auditEvent.count({ where: { organizationId, entityId: user.id, eventType: "authentication.identity_linked" } })).toBe(1);
  });
  it("rejects linking a subject already owned by another user", async () => {
    const tag = `subject-conflict-${Date.now()}`, [owner, target] = await Promise.all([db.user.create({ data: { email: `${tag}-owner@example.test`, status: "ACTIVE", authProviderUserId: `${tag}-subject` } }), db.user.create({ data: { email: `${tag}-target@example.test`, status: "ACTIVE" } })]);
    await Promise.all([owner, target].map(user => db.organizationMembership.create({ data: { organizationId, userId: user.id, status: "ACTIVE" } })));
    await expect(linkCognitoIdentity({ userId: target.id, subject: `${tag}-subject` })).rejects.toThrow(/another user/);
  });
  it("rejects linking a user already bound to another subject", async () => {
    const tag = `user-conflict-${Date.now()}`, user = await db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE", authProviderUserId: `${tag}-existing` } });
    await db.organizationMembership.create({ data: { organizationId, userId: user.id, status: "ACTIVE" } });
    await expect(linkCognitoIdentity({ userId: user.id, subject: `${tag}-different` })).rejects.toThrow(/different external identity/);
  });
});
