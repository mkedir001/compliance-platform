import { createHmac } from "node:crypto";

const base = process.env.SMOKE_BASE_URL;
if (!base || !base.startsWith("https://")) throw new Error("SMOKE_BASE_URL must be the deployed HTTPS origin");

async function expectStatus(path: string, expected: number | number[], init?: RequestInit) {
  const response = await fetch(new URL(path, base), { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) throw new Error(`${path} returned ${response.status}; expected ${statuses.join("/")}`);
  return response;
}

await expectStatus("/api/health/live", 200);
const readiness = await expectStatus("/api/health/ready", 200);
const readyBody = await readiness.json() as Record<string, unknown>;
for (const dependency of ["database", "rateLimiter", "evidenceStorage"]) if (readyBody[dependency] !== "available") throw new Error(`Readiness did not confirm ${dependency}`);
await expectStatus("/api/jobs/compliance", 401, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "invalid" }) });

const userId = process.env.SMOKE_USER_ID, organizationId = process.env.SMOKE_ORGANIZATION_ID, authSecret = process.env.AUTH_PROXY_SECRET;
if (userId || organizationId || authSecret) {
  if (!userId || !organizationId || !authSecret) throw new Error("SMOKE_USER_ID, SMOKE_ORGANIZATION_ID, and AUTH_PROXY_SECRET must be supplied together");
  const authenticatedHeaders = () => {
    const timestamp = String(Date.now());
    return { "x-auth-user-id": userId, "x-auth-timestamp": timestamp, "x-auth-signature": createHmac("sha256", authSecret).update(`${timestamp}.${userId}`).digest("hex") };
  };
  await expectStatus(`/api/organizations/${organizationId}`, 200, { headers: authenticatedHeaders() });
  await expectStatus(`/api/organizations/${organizationId}/notifications`, 200, { headers: authenticatedHeaders() });
  await expectStatus(`/api/organizations/${organizationId}/reports/training`, 200, { headers: authenticatedHeaders() });
  await expectStatus("/api/organizations/not-a-real-tenant", [400, 403, 404], { headers: authenticatedHeaders() });
  if (process.env.SMOKE_RUN_JOB === "true") {
    if (!process.env.JOB_SECRET) throw new Error("JOB_SECRET is required when SMOKE_RUN_JOB=true");
    await expectStatus("/api/jobs/compliance", 200, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
  }
}

console.info("Production smoke checks passed");
