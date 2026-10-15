import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  version: z.string().optional(), event: z.string().min(1).max(200), description: z.string().max(1000).optional(),
  data: z.object({ entity: z.string().max(100).optional(), action: z.string().max(100).optional(), id: z.union([z.string(), z.number()]).optional() }).passthrough().optional(),
  timestamp: z.union([z.string(), z.number()]).optional()
}).passthrough();

/** AxisCare sends no signature, only the x-webhook-id header we registered, so compare it in constant time. */
export function webhookIdMatches(received: string | null, expected: string) {
  const a = createHash("sha256").update(received ?? "").digest(), b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function parseWebhook(body: unknown) {
  const p = payloadSchema.parse(body);
  const entityId = p.data?.id === undefined ? null : String(p.data.id);
  const dedupeKey = createHash("sha256").update(JSON.stringify([p.event, p.data?.entity ?? null, p.data?.action ?? null, entityId, p.timestamp ?? null, p.data ? JSON.stringify(p.data) : null])).digest("hex");
  return { event: p.event, entity: p.data?.entity ?? null, action: p.data?.action ?? null, entityId, dedupeKey, payload: p };
}
