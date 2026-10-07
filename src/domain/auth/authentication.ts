import { createHmac, timingSafeEqual } from "node:crypto";
import { AlbJwksCache } from "aws-jwt-verify/alb-cache";
import { AlbJwtVerifier } from "aws-jwt-verify/alb-verifier";
import { SimpleFetcher, type Fetcher } from "aws-jwt-verify/https";
import { prisma } from "@/lib/prisma";
import { productionEnvironment, type ProductionEnvironment } from "@/lib/env";
import { AuthenticationError } from "./errors";
import { developmentVisualQaMode } from "./development-visual-qa";

export const DEVELOPMENT_VISUAL_QA_COOKIE = "compliance_visual_qa_user";

export function developmentVisualQaUserId(request: Request) {
  if (!developmentVisualQaMode()) return null;
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === DEVELOPMENT_VISUAL_QA_COOKIE) {
      try { return decodeURIComponent(value.join("=")); } catch { return null; }
    }
  }
  return null;
}

export function productionAuthSignature(userId: string, timestamp: string, secret: string) { return createHmac("sha256", secret).update(`${timestamp}.${userId}`).digest("hex"); }
function legacyProductionUserId(request: Request, config: Extract<ProductionEnvironment, { PRODUCTION_AUTH_MODE: "trusted-proxy-hmac" }>) {
  const userId = request.headers.get("x-auth-user-id"), timestamp = request.headers.get("x-auth-timestamp"), signature = request.headers.get("x-auth-signature");
  if (!userId || !timestamp || !signature || !/^\d+$/.test(timestamp)) throw new AuthenticationError("Authentication required");
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) throw new AuthenticationError("Authentication assertion expired");
  const expected = productionAuthSignature(userId, timestamp, config.AUTH_PROXY_SECRET), received = Buffer.from(signature, "hex"), expectedBytes = Buffer.from(expected, "hex");
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) throw new AuthenticationError("Authentication assertion invalid");
  return userId;
}

type AlbConfiguration = Extract<ProductionEnvironment, { PRODUCTION_AUTH_MODE: "aws-alb-cognito" }>;
type AlbAssertion = { sub?: unknown; email?: unknown; email_verified?: unknown };
type AssertionVerifier = { verify(assertion: string): Promise<AlbAssertion> };
let cachedVerifier: { key: string; verifier: AssertionVerifier } | undefined;

export function createAlbAssertionVerifier(config: AlbConfiguration, fetcher?: Fetcher): AssertionVerifier {
  const jwksCache = new AlbJwksCache({ fetcher: fetcher ?? new SimpleFetcher({ defaultRequestOptions: { timeout: 2_000, responseTimeout: 2_000 } }) });
  return AlbJwtVerifier.create({
    albArn: config.AWS_ALB_AUTH_SIGNER_ARN,
    issuer: config.AWS_ALB_AUTH_ISSUER,
    clientId: config.AWS_ALB_AUTH_CLIENT_ID,
    graceSeconds: 0,
    includeRawJwtInErrors: false,
    customJwtCheck: ({ header, payload }) => {
      if (header.alg !== "ES256" || !Number.isFinite(header.exp) || header.exp < Date.now() / 1000 || header.iss !== config.AWS_ALB_AUTH_ISSUER) throw new Error("Invalid ALB assertion claims");
      if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 256) throw new Error("Invalid ALB subject claim");
    },
  }, { jwksCache });
}

function productionVerifier(config: AlbConfiguration) {
  const key = `${config.AWS_ALB_AUTH_SIGNER_ARN}\n${config.AWS_ALB_AUTH_ISSUER}\n${config.AWS_ALB_AUTH_CLIENT_ID}`;
  if (!cachedVerifier || cachedVerifier.key !== key) cachedVerifier = { key, verifier: createAlbAssertionVerifier(config) };
  return cachedVerifier.verifier;
}

function enforceProductionOrigin(request: Request, appBaseUrl: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(appBaseUrl).origin) throw new AuthenticationError("Request origin rejected");
}

async function verifiedAlbIdentity(request: Request, config: AlbConfiguration, verifier?: AssertionVerifier) {
  enforceProductionOrigin(request, config.APP_BASE_URL);
  const assertion = request.headers.get("x-amzn-oidc-data");
  if (!assertion) throw new AuthenticationError("Authentication required");
  try {
    const payload = await (verifier ?? productionVerifier(config)).verify(assertion);
    if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 256) throw new Error("Invalid subject");
    return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null, emailVerified: payload.email_verified === true || payload.email_verified === "true" };
  } catch {
    throw new AuthenticationError("Authentication assertion invalid");
  }
}

export async function requireVerifiedInvitationIdentity(request: Request, dependencies: { albVerifier?: AssertionVerifier } = {}) {
  if (process.env.NODE_ENV !== "production") {
    const userId = request.headers.get("x-dev-user-id") ?? process.env.DEV_USER_ID;
    if (!userId) throw new AuthenticationError("Authentication required");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new AuthenticationError("Authenticated identity is unavailable");
    return { subject: user.authProviderUserId ?? `development:${user.id}`, email: user.email.trim().toLowerCase(), emailVerified: true as const };
  }
  const config = productionEnvironment()!;
  if (config.PRODUCTION_AUTH_MODE !== "aws-alb-cognito") throw new AuthenticationError("Invitation onboarding requires Cognito authentication");
  const identity = await verifiedAlbIdentity(request, config, dependencies.albVerifier);
  if (!identity.email || !identity.emailVerified) throw new AuthenticationError("A verified email identity is required");
  return { subject: identity.subject, email: identity.email, emailVerified: true as const };
}

/** Production uses exactly one configured upstream authentication mechanism.
 * Development identity headers are never accepted in production. */
export async function requireAuthenticatedUser(request: Request, dependencies: { albVerifier?: AssertionVerifier } = {}) {
  if (process.env.NODE_ENV !== "production") {
    const userId = request.headers.get("x-dev-user-id") ?? developmentVisualQaUserId(request) ?? process.env.DEV_USER_ID;
    if (!userId) throw new AuthenticationError("Authentication required");
    const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" } });
    if (!user) throw new AuthenticationError("Active user not found");
    return user;
  }

  const config = productionEnvironment()!;
  enforceProductionOrigin(request, config.APP_BASE_URL);
  if (config.PRODUCTION_AUTH_MODE === "trusted-proxy-hmac") {
    const userId = legacyProductionUserId(request, config);
    const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" } });
    if (!user) throw new AuthenticationError("Active user not found");
    return user;
  }

  const { subject } = await verifiedAlbIdentity(request, config, dependencies.albVerifier);
  const user = await prisma.user.findFirst({ where: { authProviderUserId: subject, status: "ACTIVE" } });
  if (!user) throw new AuthenticationError("Active user not found");
  return user;
}
