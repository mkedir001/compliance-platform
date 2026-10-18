import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDocumentPdfDelivery, importClientDocument, markImportedDocumentSigned, updateClientDocumentDetails } from "@/domain/clients/documents";
import { getClientRenewalSummary } from "@/domain/clients/renewals";

const db = new PrismaClient();

describe.sequential("client document names, expiration, and external signature attestation", () => {
  let organizationId = "", otherOrganizationId = "", adminId = "", viewerId = "", clientId = "", documentId = "";
  const admin = () => ({ id: adminId }), viewer = () => ({ id: viewerId });

  beforeAll(async () => {
    const tag = `document-details-${Date.now()}`;
    const [organization, otherOrganization, adminUser, viewerUser] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag, timezone: "America/Chicago" } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `${tag}-admin@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-viewer@example.test`, status: "ACTIVE" } })
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; adminId = adminUser.id; viewerId = viewerUser.id;
    await db.permission.upsert({where:{code:"client.document.read"},update:{},create:{code:"client.document.read"}});
    const permissions = await db.permission.findMany({ where: { code: { in: ["client.document.generate", "client.document.read", "client.read"] } } });
    const role = await db.roleDefinition.create({ data: { organizationId, code: `DOCUMENT_MANAGER_${Date.now()}`, name: "Document manager", scope: "ORGANIZATION", permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    const [adminMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: adminId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } })
    ]);
    await db.membershipRole.create({ data: { membershipId: adminMembership.id, roleDefinitionId: role.id } });
    const template = await db.clientDocumentTemplate.create({ data: { organizationId, code: `IMPORTED-FACE-${tag}`, name: "Imported face sheet", documentType: "FACE_SHEET", versionNumber: 1, renewalPolicy: "NONE", contentJson: {} } });
    const client = await db.client.create({ data: { organizationId, createdByUserId: adminId, legalFirstName: "Synthetic", legalLastName: "Document", status: "ACTIVE" } });
    clientId = client.id;
    const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
    const imported = await importClientDocument(admin(), organizationId, clientId, { documentType: "FACE_SHEET", fileName: "synthetic-face.pdf", pdfBase64: Buffer.from(await pdf.save()).toString("base64"), disposition: "CURRENT_SIGNATURE_REQUIRED" });
    documentId = imported.id;
    expect(template.id).toBeTruthy();
  });

  it("persists optional date-only metadata without changing stored content or fabricating an absent deadline", async () => {
    const before = await db.clientDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect((await getClientRenewalSummary(admin(), organizationId, clientId, new Date("2027-10-01T12:00:00Z"))).cycles).toEqual([]);
    await updateClientDocumentDetails(admin(), organizationId, clientId, documentId, { displayName: "County face sheet", expirationDate: "2027-10-20" });
    const after = await db.clientDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(after.displayName).toBe("County face sheet");
    expect(after.expirationDate?.toISOString().slice(0, 10)).toBe("2027-10-20");
    expect(after.renderedPdf).toEqual(before.renderedPdf);
    expect(after.finalPdf).toEqual(before.finalPdf);
    expect(after.sourceDocumentHash).toBe(before.sourceDocumentHash);
    expect((await getClientRenewalSummary(admin(), organizationId, clientId, new Date("2027-10-01T12:00:00Z"))).cycles).toEqual([]);
    expect(await db.auditEvent.count({ where: { organizationId, entityId: documentId, eventType: "client.document_details_updated" } })).toBe(1);
  });

  it("enforces permissions and tenant scope for metadata changes", async () => {
    await expect(updateClientDocumentDetails(viewer(), organizationId, clientId, documentId, { displayName: "Unauthorized" })).rejects.toThrow(/client\.document\.generate/);
    await expect(updateClientDocumentDetails(admin(), otherOrganizationId, clientId, documentId, { displayName: "Cross tenant" })).rejects.toThrow();
    expect((await db.clientDocument.findUniqueOrThrow({ where: { id: documentId } })).displayName).toBe("County face sheet");
  });

  it("authorizes imported PDF delivery by permission and tenant while preserving original bytes",async()=>{const stored=await db.clientDocument.findUniqueOrThrow({where:{id:documentId}}),delivery=await getDocumentPdfDelivery(admin(),organizationId,clientId,documentId,"current");expect(delivery.previewTransform).toBe("ORIGINAL");expect(delivery.bytes).toEqual(Buffer.from(stored.renderedPdf!));await expect(getDocumentPdfDelivery(viewer(),organizationId,clientId,documentId,"current")).rejects.toThrow(/client\.document\.read/);await expect(getDocumentPdfDelivery(admin(),otherOrganizationId,clientId,documentId,"current")).rejects.toThrow()});

  it("fails safely when a tenant-scoped document has no stored rendition",async()=>{const template=await db.clientDocumentTemplate.findFirstOrThrow({where:{organizationId,documentType:"FACE_SHEET"}}),missing=await db.clientDocument.create({data:{organizationId,clientId,templateId:template.id,documentType:"FACE_SHEET",source:"IMPORTED",status:"DRAFT",snapshotJson:{synthetic:true},generatedByUserId:adminId}});await expect(getDocumentPdfDelivery(admin(),organizationId,clientId,missing.id,"current")).rejects.toThrow(/Rendered document not found/)});

  it("rejects future dates and records a non-platform-verified external signature without altering the original", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    await expect(markImportedDocumentSigned(admin(), organizationId, clientId, documentId, { signedDate: "2026-10-18" })).rejects.toThrow(/future/);
    const before = await db.clientDocument.findUniqueOrThrow({ where: { id: documentId } });
    await markImportedDocumentSigned(admin(), organizationId, clientId, documentId, { signedDate: "2026-10-17", note: "Reviewed synthetic signed copy" });
    vi.useRealTimers();
    const after = await db.clientDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(after.status).toBe("COMPLETED");
    expect(after.authoritativeCompletedAt?.toISOString().slice(0, 10)).toBe("2026-10-17");
    expect(after.renderedPdf).toEqual(before.renderedPdf);
    expect(after.finalPdf).toEqual(before.renderedPdf);
    expect(after.sourceDocumentHash).toBe(before.sourceDocumentHash);
    expect(after.snapshotJson).toEqual(expect.objectContaining({ importReview: expect.objectContaining({ platformVerified: false, signatureStatus: "CONFIRMED_EXTERNAL" }) }));
    expect(await db.signatureEnvelope.count({ where: { documentId } })).toBe(0);
    const summary = await getClientRenewalSummary(admin(), organizationId, clientId, new Date("2027-10-01T12:00:00Z"));
    expect(summary.cycles).toEqual([expect.objectContaining({ documentId, dueDate: "2027-10-20", status: "DUE_SOON" })]);
    expect(await db.auditEvent.count({ where: { organizationId, entityId: documentId, eventType: "client.document_marked_signed" } })).toBe(1);
    await expect(markImportedDocumentSigned(admin(), organizationId, clientId, documentId, { signedDate: "2026-10-17" })).rejects.toThrow(/already signed|not open/);
  });

  it("never treats platform-generated documents as externally signed", async () => {
    const template = await db.clientDocumentTemplate.findFirstOrThrow({ where: { organizationId, documentType: "FACE_SHEET" } });
    const generated = await db.clientDocument.create({ data: { organizationId, clientId, templateId: template.id, documentType: "FACE_SHEET", source: "GENERATED", status: "READY_FOR_SIGNATURE", snapshotJson: {}, renderedPdf: Buffer.from("%PDF-synthetic"), generatedByUserId: adminId } });
    await expect(markImportedDocumentSigned(admin(), organizationId, clientId, generated.id, { signedDate: "2026-10-17" })).rejects.toThrow(/Only an imported document/);
  });
});
