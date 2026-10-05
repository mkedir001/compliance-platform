import { InvalidMailgunWebhookError, reconcileMailgunWebhook } from "@/domain/notifications/mailgun-events";

export async function POST(request: Request) {
  try {
    const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (!key) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
    const result = await reconcileMailgunWebhook(await request.json(), key);
    return Response.json(result, { status: result.status === "UNKNOWN_MESSAGE" ? 202 : 200 });
  } catch (error) {
    if (error instanceof InvalidMailgunWebhookError || error instanceof SyntaxError) return Response.json({ error: "Invalid webhook" }, { status: 401 });
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
