import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { productionEnvironment } from "@/lib/env";

export const claimContinuationCookie = "employee_claim_continuation";
const lifetimeSeconds = 10 * 60;

function secret() {
  const value = process.env.JOB_SECRET;
  if (!value || value.length < 32) throw new Error("Claim continuation signing is unavailable");
  return value;
}

export function createClaimContinuation(token: string, now = Date.now()) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret()).digest(), iv), plaintext = JSON.stringify({ token, expiresAt: now + lifetimeSeconds * 1000 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function readClaimContinuation(value: string | undefined, now = Date.now()) {
  if (!value) return null;
  const [ivSource, ciphertextSource, tagSource, extra] = value.split(".");
  if (!ivSource || !ciphertextSource || !tagSource || extra) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret()).digest(), Buffer.from(ivSource, "base64url"));
    decipher.setAuthTag(Buffer.from(tagSource, "base64url"));
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextSource, "base64url")), decipher.final()]).toString("utf8")) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token !== "string" || parsed.token.length < 32 || parsed.token.length > 256 || typeof parsed.expiresAt !== "number" || parsed.expiresAt < now) return null;
    return parsed.token;
  } catch { return null; }
}

export function cognitoLogoutUrl() {
  const config = productionEnvironment();
  if (!config || config.PRODUCTION_AUTH_MODE !== "aws-alb-cognito") throw new Error("Cognito logout is unavailable");
  const url = new URL("/logout", config.AWS_COGNITO_DOMAIN);
  url.searchParams.set("client_id", config.AWS_ALB_AUTH_CLIENT_ID);
  url.searchParams.set("logout_uri", `${config.APP_BASE_URL.replace(/\/$/, "")}/learn/claim/resume`);
  return url.toString();
}

export function claimContinuationMaxAge() { return lifetimeSeconds; }
