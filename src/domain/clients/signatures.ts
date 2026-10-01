import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SignatureMode, User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { reconcileCompletedDocumentRequests } from "@/domain/clients/document-requests";

export interface ESignatureProvider {
  readonly name: string;
  createEnvelope(input: { documentId: string; mode: SignatureMode; signers: { id: string; name: string; email: string | null }[] }): Promise<{ providerEnvelopeId: string }>;
  createSigningSession(envelopeId: string, signerId: string): Promise<{ url: string }>;
  send(envelopeId: string, signerId: string): Promise<void>;
  retrieveCompletedDocument(envelopeId: string): Promise<Uint8Array | null>;
  void(envelopeId: string): Promise<void>;
}
export class LocalTestSignatureProvider implements ESignatureProvider {
  readonly name = "local-test-only";
  private allowed() {
    if (process.env.NODE_ENV === "production") throw new AuthorizationError("Local signature provider is disabled in production");
  }
  async createEnvelope(input: { documentId: string }) {
    this.allowed();
    return { providerEnvelopeId: `local:${input.documentId}` };
  }
  async createSigningSession(envelopeId: string, signerId: string) {
    this.allowed();
    return { url: `local-signing://${envelopeId}/${signerId}` };
  }
  async send() {
    this.allowed();
  }
  async retrieveCompletedDocument() {
    this.allowed();
    return null;
  }
  async void() {
    this.allowed();
  }
}

async function authorize(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "client.signature.manage");
}
const signerInput = z
  .array(
    z.object({
      role: z.enum(["CLIENT", "LEGAL_REPRESENTATIVE", "CASE_MANAGER", "ORGANIZATION_STAFF", "OTHER"]),
      name: z.string().min(1).max(200),
      email: z.string().email().optional(),
      required: z.boolean().optional(),
    }),
  )
  .min(1)
  .max(20);
export async function createSignatureEnvelope(user: Pick<User, "id">, organizationId: string, clientId: string, documentId: string, mode: SignatureMode, signers: z.input<typeof signerInput>, provider: ESignatureProvider = new LocalTestSignatureProvider()) {
  await authorize(user, organizationId);
  const rows = signerInput.parse(signers);
  if (mode === "SEND_FOR_SIGNATURE" && rows.some((row) => !row.email)) throw new AuthorizationError("Remote signers require an email address");
  const document = await prisma.clientDocument.findFirst({
    where: {
      id: documentId,
      organizationId,
      clientId,
      status: { in: ["READY_FOR_SIGNATURE", "PARTIALLY_SIGNED"] },
    },
  });
  if (!document) throw new ResourceNotFoundError("Signature-ready document not found");
  const envelope = await prisma.signatureEnvelope.create({
    data: {
      organizationId,
      clientId,
      documentId,
      mode,
      provider: provider.name,
      status: "READY",
      signers: { create: rows.map((row) => ({ ...row, status: "PENDING" })) },
    },
    include: { signers: true },
  });
  const remote = await provider.createEnvelope({
    documentId,
    mode,
    signers: envelope.signers.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    })),
  });
  const status = mode === "SEND_FOR_SIGNATURE" ? "SENT" : "READY",
    sentAt = mode === "SEND_FOR_SIGNATURE" ? new Date() : null;
  const updated = await prisma.signatureEnvelope.update({
    where: { id: envelope.id },
    data: { providerEnvelopeId: remote.providerEnvelopeId, status, sentAt },
    include: { signers: true },
  });
  if (mode === "SEND_FOR_SIGNATURE")
    for (const signer of updated.signers) {
      await provider.send(updated.id, signer.id);
      await prisma.signatureSigner.update({
        where: { id: signer.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    }
  await prisma.auditEvent.create({
    data: {
      organizationId,
      actorUserId: user.id,
      eventType: document.renewalOfDocumentId ? (mode === "SIGN_NOW" ? "client.document_renewal_sign_now_initiated" : "client.document_renewal_sent_for_signature") : "client.signature_requested",
      entityType: "SignatureEnvelope",
      entityId: envelope.id,
      metadataJson: {
        documentId,
        mode,
        signerCount: rows.length,
        provider: provider.name,
        renewalOfDocumentId: document.renewalOfDocumentId,
      },
    },
  });
  return prisma.signatureEnvelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: { signers: true },
  });
}
export async function createSignNowSession(user: Pick<User, "id">, organizationId: string, clientId: string, envelopeId: string, signerId: string, provider: ESignatureProvider = new LocalTestSignatureProvider()) {
  await authorize(user, organizationId);
  const envelope = await prisma.signatureEnvelope.findFirst({
    where: {
      id: envelopeId,
      organizationId,
      clientId,
      mode: "SIGN_NOW",
      signers: { some: { id: signerId } },
    },
  });
  if (!envelope) throw new ResourceNotFoundError("Signing session not found");
  return provider.createSigningSession(envelope.id, signerId);
}
export async function recordLocalTestSignature(user: Pick<User, "id">, organizationId: string, clientId: string, envelopeId: string, signerId: string, provider: ESignatureProvider = new LocalTestSignatureProvider()) {
  await authorize(user, organizationId);
  if (provider.name !== "local-test-only" || process.env.NODE_ENV === "production") throw new AuthorizationError("Test signatures cannot be recorded as production execution");
  const envelope = await prisma.signatureEnvelope.findFirst({
    where: { id: envelopeId, organizationId, clientId },
    include: { signers: true, document: true },
  });
  if (!envelope) throw new ResourceNotFoundError("Signature envelope not found");
  const signer = envelope.signers.find((row) => row.id === signerId);
  if (!signer) throw new ResourceNotFoundError("Signer not found");
  if (signer.status === "SIGNED")
    return prisma.signatureEnvelope.findUniqueOrThrow({
      where: { id: envelope.id },
      include: { signers: true, document: true },
    });
  const signedAt = new Date();
  await prisma.signatureSigner.update({
    where: { id: signer.id },
    data: {
      status: "SIGNED",
      viewedAt: signer.viewedAt ?? signedAt,
      signedAt,
      auditJson: { provider: "local-test-only", legalExecution: false },
    },
  });
  const signers = await prisma.signatureSigner.findMany({
      where: { envelopeId },
      orderBy: { createdAt: "asc" },
    }),
    required = signers.filter((row) => row.required),
    complete = required.every((row) => row.status === "SIGNED"),
    status = complete ? "COMPLETED" : "PARTIALLY_SIGNED",
    authoritativeCompletedAt = complete ? new Date(Math.max(...required.map((row) => row.signedAt!.getTime()))) : null;
  await prisma.signatureEnvelope.update({
    where: { id: envelope.id },
    data: { status, completedAt: authoritativeCompletedAt },
  });
  if (complete) {
    if (!envelope.document.renderedPdf) throw new AuthorizationError("Rendered document unavailable");
    const finalPdf = await addLocalAuditPage(Buffer.from(envelope.document.renderedPdf), signers);
    await prisma.clientDocument.update({
      where: { id: envelope.documentId },
      data: {
        status: "COMPLETED",
        finalPdf: Buffer.from(finalPdf),
        finalizedAt: envelope.document.finalizedAt ?? signedAt,
        authoritativeCompletedAt,
      },
    });
  } else
    await prisma.clientDocument.update({
      where: { id: envelope.documentId },
      data: { status: "PARTIALLY_SIGNED" },
    });
  await prisma.auditEvent.create({
    data: {
      organizationId,
      actorUserId: user.id,
      eventType: "client.signer_completed",
      entityType: "SignatureEnvelope",
      entityId: envelope.id,
      metadataJson: {
        signerId,
        provider: "local-test-only",
        legalExecution: false,
        renewalOfDocumentId: envelope.document.renewalOfDocumentId,
      },
    },
  });
  if (complete)
    await prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: user.id,
        eventType: envelope.document.renewalOfDocumentId ? "client.document_renewal_cycle_established" : "client.signature_envelope_completed",
        entityType: "SignatureEnvelope",
        entityId: envelope.id,
        metadataJson: {
          provider: "local-test-only",
          legalExecution: false,
          authoritativeCompletedAt: authoritativeCompletedAt!.toISOString(),
          renewalOfDocumentId: envelope.document.renewalOfDocumentId,
        },
      },
    });
  if (complete && envelope.document.renewalOfDocumentId)
    await prisma.auditEvent.createMany({
      data: [
        {
          organizationId,
          actorUserId: user.id,
          eventType: "client.document_previous_cycle_superseded",
          entityType: "ClientDocument",
          entityId: envelope.document.renewalOfDocumentId,
          metadataJson: { renewalDocumentId: envelope.documentId },
        },
        {
          organizationId,
          actorUserId: user.id,
          eventType: "client.document_renewal_issue_resolved",
          entityType: "ClientDocument",
          entityId: envelope.documentId,
          metadataJson: {
            previousDocumentId: envelope.document.renewalOfDocumentId,
          },
        },
      ],
    });
  if (complete) await reconcileCompletedDocumentRequests(organizationId, clientId, envelope.documentId, user.id, authoritativeCompletedAt!);
  return prisma.signatureEnvelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: { signers: true, document: true },
  });
}
async function addLocalAuditPage(source: Buffer, signers: { role: string; name: string; signedAt: Date | null }[]) {
  const pdf = await PDFDocument.load(source),
    page = pdf.addPage([612, 792]),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Development signature workflow record", {
    x: 54,
    y: 730,
    size: 18,
    font: bold,
  });
  page.drawText("NOT A PRODUCTION LEGAL SIGNATURE", {
    x: 54,
    y: 700,
    size: 12,
    font: bold,
  });
  let y = 660;
  for (const signer of signers) {
    page.drawText(`${signer.role}: ${signer.name} - ${signer.signedAt?.toISOString() ?? "pending"}`, { x: 54, y, size: 10, font });
    y -= 24;
  }
  return pdf.save();
}
