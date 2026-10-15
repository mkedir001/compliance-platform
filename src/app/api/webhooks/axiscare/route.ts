import { after } from "next/server";
import { axisCareConfig } from "@/domain/axiscare/config";
import { processWebhookEvent } from "@/domain/axiscare/sync";
import { parseWebhook, webhookIdMatches } from "@/domain/axiscare/webhook";
import { prisma } from "@/lib/prisma";

// AxisCare requires a 200/202 within 5 seconds, so we store the raw event and process it after responding.
export async function POST(request: Request) {
  const config = axisCareConfig();
  if (!config) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  if (!webhookIdMatches(request.headers.get("x-webhook-id"), config.AXISCARE_WEBHOOK_ID)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let parsed;
  try { parsed = parseWebhook(await request.json()); } catch { return Response.json({ error: "Invalid webhook" }, { status: 400 }); }
  try {
    const organizationId = config.AXISCARE_ORGANIZATION_ID;
    const existing = await prisma.axisCareWebhookEvent.findUnique({ where: { organizationId_dedupeKey: { organizationId, dedupeKey: parsed.dedupeKey } }, select: { id: true } });
    if (existing) return Response.json({ status: "duplicate" }, { status: 202 });
    const row = await prisma.axisCareWebhookEvent.create({ data: { organizationId, dedupeKey: parsed.dedupeKey, event: parsed.event, entity: parsed.entity, action: parsed.action, entityId: parsed.entityId, payload: parsed.payload as object }, select: { id: true } });
    after(() => processWebhookEvent(config, row.id));
    return Response.json({ status: "accepted" }, { status: 202 });
  } catch {
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
