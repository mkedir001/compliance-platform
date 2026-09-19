import { createHash } from "node:crypto";
import { AuthorizationError } from "@/domain/auth/errors";
import { productionEnvironment } from "@/lib/env";

const local = new Map<string, { count: number; resetAt: number }>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function enforceRateLimit(scope: string, key: string, limit: number, windowSeconds: number) {
  const hashedKey = digest(`${scope}:${key}`), production = productionEnvironment();
  if (production) {
    const response = await fetch(production.RATE_LIMIT_URL, { method: "POST", headers: { authorization: `Bearer ${production.RATE_LIMIT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ scope, key: hashedKey, limit, windowSeconds }), cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Production rate-limit service unavailable");
    const result = await response.json() as { allowed?: boolean };
    if (!result.allowed) throw new AuthorizationError("Request rate limit exceeded");
    return;
  }
  const now = Date.now(), id = `${scope}:${hashedKey}`, current = local.get(id);
  if (!current || current.resetAt <= now) { local.set(id, { count: 1, resetAt: now + windowSeconds * 1000 }); return; }
  current.count += 1;
  if (current.count > limit) throw new AuthorizationError("Request rate limit exceeded");
}
export async function probeRateLimiter() {
  const production = productionEnvironment();
  if (!production) return true;
  const response = await fetch(production.RATE_LIMIT_URL, { method: "POST", headers: { authorization: `Bearer ${production.RATE_LIMIT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "readiness", key: digest("readiness"), limit: 1, windowSeconds: 1 }), cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Production rate-limit service unavailable");
  const result = await response.json() as { allowed?: unknown };
  if (typeof result.allowed !== "boolean") throw new Error("Production rate-limit service returned an invalid response");
  return true;
}
/** The trusted edge enforces IP limits. The application key uses only server-authenticated identity;
 * arbitrary forwarding headers are intentionally ignored because Request does not expose peer IP. */
export function requestRateKey(_request: Request, actor = "anonymous") { return actor; }
export function resetLocalRateLimits() { local.clear(); }
