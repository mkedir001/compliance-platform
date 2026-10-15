import { timingSafeEqual } from "node:crypto";
import { AuthenticationError, errorResponse } from "@/domain/auth/errors";
import { listAxisCareConfigs } from "@/domain/axiscare/config";
import { processPendingWebhookEvents, runFullSync, testConnection } from "@/domain/axiscare/sync";
import { validateProductionEnvironment } from "@/lib/env";
import { recordOperationalEvent } from "@/lib/observability";

function authorized(request: Request, secret: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const received = Buffer.from(token), expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// POST ?mode=test checks the connection only; default runs retries for stored webhook events plus the incremental sync.
export async function POST(request: Request) {
  try {
    let jobSecret;
    try { jobSecret = validateProductionEnvironment().JOB_SECRET; } catch { throw new Error("Production job configuration unavailable"); }
    if (!authorized(request, jobSecret)) throw new AuthenticationError("Job authentication required");
    const configs = await listAxisCareConfigs();
    if (!configs.length) return Response.json({ error: "AxisCare is not configured" }, { status: 503 });
    const testing = new URL(request.url).searchParams.get("mode") === "test", results = [];
    for (const config of configs) {
      if (testing) results.push({ organizationId: config.AXISCARE_ORGANIZATION_ID, connection: await testConnection(config) });
      else {
        const webhookEventsRetried = await processPendingWebhookEvents(config), result = await runFullSync(config);
        await recordOperationalEvent({ level: result.failures.length ? "error" : "info", operation: "axiscare.sync.completed", organizationId: config.AXISCARE_ORGANIZATION_ID });
        results.push({ organizationId: config.AXISCARE_ORGANIZATION_ID, webhookEventsRetried, ...result });
      }
    }
    return Response.json({ results });
  } catch (error) {
    await recordOperationalEvent({ level: "error", operation: "axiscare.sync.failed", errorName: error instanceof Error ? error.name : "UnknownError", message: "AxisCare sync failed" });
    return errorResponse(error);
  }
}
