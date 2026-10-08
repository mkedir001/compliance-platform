import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidMailgunWebhookError, reconcileMailgunWebhook } from "@/domain/notifications/mailgun-events";
import { prisma } from "@/lib/prisma";

describe("Mailgun delivery reconciliation", () => {
  const tag = `mailgun-events-${Date.now()}`, signingKey = "synthetic-mailgun-webhook-signing-key-1234567890";
  let organizationId = "", communicationId = "", attemptId = "", invitationId = "";

  beforeAll(async () => {
    const [organization, actor] = await Promise.all([
      prisma.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      prisma.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id;
    const employee = await prisma.employee.create({ data: { organizationId, firstName: "Synthetic", lastName: "Recipient", employmentStatus: "ACTIVE" } });
    const invitation = await prisma.employeePortalInvitation.create({ data: { organizationId, employeeId: employee.id, invitedEmail: `${tag}-recipient@example.test`, tokenHash: tag, invitedByUserId: actor.id, deliveryStatus: "ACCEPTED", deliveryProvider: "mailgun", providerMessageId: `<${tag}@mail.waldah.com>`, providerAcceptedAt: new Date() } });
    invitationId = invitation.id;
    const communication = await prisma.emailCommunication.create({ data: { organizationId, purpose: "WORKFORCE_TRANSACTIONAL", logicalType: "EmployeePortalInvitation", logicalId: invitation.id, state: "PROVIDER_ACCEPTED", selectedProvider: "mailgun", providerMessageId: invitation.providerMessageId, providerAcceptedAt: invitation.providerAcceptedAt } });
    communicationId = communication.id;
    const attempt = await prisma.emailProviderAttempt.create({ data: { communicationId, sequence: 1, provider: "mailgun", outcome: "ACCEPTED", providerMessageId: invitation.providerMessageId, attemptedAt: new Date(), acceptedAt: invitation.providerAcceptedAt } });
    attemptId = attempt.id;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  function payload(id: string, event: string, options: { severity?: string; messageId?: string; token?: string; reason?: string; timestamp?:number } = {}) {
    const timestamp = String(options.timestamp??Math.floor(Date.now() / 1000)), token = options.token ?? `${id}-token`;
    return { signature: { timestamp, token, signature: createHmac("sha256", signingKey).update(timestamp + token).digest("hex") }, "event-data": { id, event, severity: options.severity, reason: options.reason, timestamp: Number(timestamp), message: { headers: { "message-id": options.messageId ?? `<${tag}@mail.waldah.com>` }, body: "must never be persisted" }, "delivery-status": { code: 250, "enhanced-code": "2.0.0" }, recipient: "must-not-be-persisted@example.test" } };
  }

  it("keeps provider acceptance distinct until an authenticated delivery event arrives", async () => {
    expect(await prisma.emailCommunication.findUniqueOrThrow({ where: { id: communicationId } })).toMatchObject({ state: "PROVIDER_ACCEPTED", deliveryState: "NOT_CONFIRMED", deliveredAt: null });
    const delivered = payload(`${tag}-delivered`, "delivered");
    await expect(reconcileMailgunWebhook(delivered, signingKey)).resolves.toEqual({ status: "RECONCILED", deliveryState: "DELIVERED" });
    await expect(reconcileMailgunWebhook(delivered, signingKey)).resolves.toEqual({ status: "DUPLICATE", deliveryState: "DELIVERED" });
    expect(await prisma.emailCommunication.findUniqueOrThrow({ where: { id: communicationId } })).toMatchObject({ state: "PROVIDER_ACCEPTED", deliveryState: "DELIVERED", deliveryErrorCode: null });
    expect(await prisma.emailProviderAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ outcome: "ACCEPTED", deliveryState: "DELIVERED" });
    expect(await prisma.employeePortalInvitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({ deliveryStatus: "DELIVERED" });
    const stored = await prisma.emailProviderEvent.findFirstOrThrow({ where: { providerEventId: `${tag}-delivered` } });
    expect(JSON.stringify(stored)).not.toContain("must never be persisted"); expect(JSON.stringify(stored)).not.toContain("must-not-be-persisted@example.test");
  });

  it("rejects invalid signatures and safely ignores unknown message identifiers", async () => {
    await expect(reconcileMailgunWebhook(payload(`${tag}-invalid`, "delivered"), "wrong-key-that-is-still-more-than-thirty-two-characters")).rejects.toBeInstanceOf(InvalidMailgunWebhookError);
    await expect(reconcileMailgunWebhook(payload(`${tag}-unknown`, "failed", { severity: "permanent", messageId: "<unknown@example.test>" }), signingKey)).resolves.toEqual({ status: "UNKNOWN_MESSAGE" });
  });

  it("records permanent failure without overwriting provider acceptance", async () => {
    const providerTimestamp=Math.floor(Date.now()/1000)+30;
    await expect(reconcileMailgunWebhook(payload(`${tag}-failed`, "failed", { severity: "permanent", reason: "espblock",timestamp:providerTimestamp }), signingKey)).resolves.toEqual({ status: "RECONCILED", deliveryState: "BOUNCED" });
    expect(await prisma.emailCommunication.findUniqueOrThrow({ where: { id: communicationId } })).toMatchObject({ state: "PROVIDER_ACCEPTED", deliveryState: "BOUNCED", deliveryErrorCode: "2.0.0" });
    expect(await prisma.employeePortalInvitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({ deliveryStatus: "BOUNCED" });
    await expect(reconcileMailgunWebhook(payload(`${tag}-older-delivered`,"delivered",{timestamp:providerTimestamp-60}),signingKey)).resolves.toEqual({status:"RECONCILED",deliveryState:"DELIVERED"});
    expect(await prisma.emailCommunication.findUniqueOrThrow({where:{id:communicationId}})).toMatchObject({deliveryState:"BOUNCED"});
  });
});
