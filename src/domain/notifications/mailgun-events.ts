import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type EmailDeliveryState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const signatureSchema = z.object({
  timestamp: z.string().regex(/^\d{10,13}$/),
  token: z.string().min(1).max(200),
  signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
});

const eventSchema = z.object({
  signature: signatureSchema,
  "event-data": z.object({
    id: z.string().min(1).max(255),
    event: z.string().min(1).max(80),
    severity: z.string().max(80).optional(),
    reason: z.string().max(200).optional(),
    timestamp: z.number().finite(),
    message: z.object({ headers: z.object({ "message-id": z.string().min(1).max(998) }).passthrough() }).passthrough(),
    "delivery-status": z.object({ code: z.union([z.string(), z.number()]).optional(), "enhanced-code": z.string().max(40).optional() }).passthrough().optional(),
  }).passthrough(),
});

export type MailgunWebhookPayload = z.infer<typeof eventSchema>;
export class InvalidMailgunWebhookError extends Error {}

function safeEqualHex(expected: string, received: string) {
  const left = Buffer.from(expected, "hex"), right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMailgunWebhook(payload: unknown, signingKey: string, now = new Date()): MailgunWebhookPayload {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success || signingKey.length < 32) throw new InvalidMailgunWebhookError("Invalid Mailgun webhook");
  const { timestamp, token, signature } = parsed.data.signature;
  const timestampMs = Number(timestamp) * (timestamp.length === 13 ? 1 : 1000);
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > 60 * 60 * 1000) throw new InvalidMailgunWebhookError("Expired Mailgun webhook");
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  if (!safeEqualHex(expected, signature.toLowerCase())) throw new InvalidMailgunWebhookError("Invalid Mailgun webhook");
  return parsed.data;
}

function deliveryState(event: string, severity?: string): EmailDeliveryState | null {
  if (event === "delivered") return "DELIVERED";
  if (event === "complained") return "COMPLAINED";
  if (event === "temporary_fail" || event === "failed" && severity === "temporary") return "DEFERRED";
  if (event === "permanent_fail" || event === "failed" && severity !== "temporary") return "BOUNCED";
  return null;
}

function safeCode(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, "_").slice(0, 80);
  return normalized || null;
}

export async function reconcileMailgunWebhook(payload: unknown, signingKey: string, now = new Date()) {
  const verified = verifyMailgunWebhook(payload, signingKey, now), event = verified["event-data"];
  const state = deliveryState(event.event, event.severity);
  if (!state) return { status: "IGNORED" as const };
  const messageId = event.message.headers["message-id"], tokenHash = createHash("sha256").update(verified.signature.token).digest("hex");
  const existing = await prisma.emailProviderEvent.findFirst({ where: { provider: "mailgun", OR: [{ providerEventId: event.id }, { signatureTokenHash: tokenHash }] } });
  if (existing) return { status: "DUPLICATE" as const, deliveryState: existing.deliveryState };
  const candidates = [messageId, messageId.startsWith("<") ? messageId.slice(1, -1) : `<${messageId}>`];
  const attempt = await prisma.emailProviderAttempt.findFirst({ where: { provider: "mailgun", providerMessageId: { in: candidates } }, include: { communication: true }, orderBy: { createdAt: "desc" } });
  if (!attempt) return { status: "UNKNOWN_MESSAGE" as const };
  const providerAt = new Date(event.timestamp * 1000), deliveredAt = state === "DELIVERED" ? providerAt : null;
  const deliveryStatus = event["delivery-status"], errorCode = state === "DELIVERED" ? null : safeCode(deliveryStatus?.["enhanced-code"] ?? deliveryStatus?.code ?? event.reason ?? event.severity ?? event.event);
  const metadata = { severity: safeCode(event.severity), reason: safeCode(event.reason), smtpCode: safeCode(deliveryStatus?.code), enhancedCode: safeCode(deliveryStatus?.["enhanced-code"]) };
  try {
    await prisma.$transaction(async tx => {
      await tx.emailProviderEvent.create({ data: { organizationId: attempt.communication.organizationId, communicationId: attempt.communicationId, providerAttemptId: attempt.id, provider: "mailgun", providerEventId: event.id, signatureTokenHash: tokenHash, eventType: event.event, deliveryState: state, providerTimestamp: providerAt, errorCode, metadataJson: metadata as Prisma.InputJsonValue } });
      if (attempt.deliveryUpdatedAt && attempt.deliveryUpdatedAt > providerAt) return;
      await tx.emailProviderAttempt.update({ where: { id: attempt.id }, data: { deliveryState: state, deliveryUpdatedAt: providerAt, deliveredAt, deliveryErrorCode: errorCode } });
      await tx.emailCommunication.update({ where: { id: attempt.communicationId }, data: { deliveryState: state, deliveryUpdatedAt: providerAt, deliveredAt, deliveryErrorCode: errorCode } });
      if (attempt.communication.logicalType === "EmployeePortalInvitation") {
        const invitationStatus = state === "DELIVERED" ? "DELIVERED" : state === "DEFERRED" ? "DEFERRED" : state === "COMPLAINED" ? "COMPLAINED" : "BOUNCED";
        const invitation = await tx.employeePortalInvitation.updateMany({ where: { id: attempt.communication.logicalId, organizationId: attempt.communication.organizationId }, data: { deliveryStatus: invitationStatus, deliveryUpdatedAt: providerAt, deliveredAt, deliveryErrorCode: errorCode } });
        if (invitation.count) await tx.auditEvent.create({ data: { organizationId: attempt.communication.organizationId, eventType: `employee.portal_invitation_${invitationStatus.toLowerCase()}`, entityType: "EmployeePortalInvitation", entityId: attempt.communication.logicalId, metadataJson: { provider: "mailgun", deliveryState: state, errorCode } } });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "DUPLICATE" as const, deliveryState: state };
    throw error;
  }
  return { status: "RECONCILED" as const, deliveryState: state };
}
