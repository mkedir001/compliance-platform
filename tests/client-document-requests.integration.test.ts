import { PDFDocument } from "pdf-lib";
import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { getActionCenter } from "@/domain/action-center/service";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { cancelDocumentRequest, createDocumentRequest, followUpDocumentRequest, linkDocumentRequestFulfillment, listDocumentRequests, sendDocumentRequest, updateDocumentRequest } from "@/domain/clients/document-requests";
import { createSignatureEnvelope, recordLocalTestSignature } from "@/domain/clients/signatures";
import { reconcileOrganizationNotifications } from "@/domain/notifications/service";

const db = new PrismaClient();

describe.sequential("client document requests, collection, and follow-up", () => {
  const at = new Date("2026-10-01T12:00:00.000Z");
  let organizationId: string, otherOrganizationId: string, administratorId: string, readerId: string, ordinaryId: string, clientId: string, otherClientId: string, representativeId: string, rightsTemplateId: string, roiTemplateId: string;
  const admin = () => ({ id: administratorId });
  const email = { name: "focused-test", configured: true, send: async () => ({ messageId: "focused-test-message" }) };

  beforeAll(async () => {
    const tag = `document-requests-${Date.now()}`;
    const [organization, otherOrganization, administrator, reader, ordinary] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag, timezone: "UTC" } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other`, timezone: "UTC" } }),
      db.user.create({ data: { email: `${tag}-admin@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-reader@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-ordinary@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; administratorId = administrator.id; readerId = reader.id; ordinaryId = ordinary.id;
    const permissions = await db.permission.findMany({ where: { code: { in: ["client.read", "client.document.generate", "client.signature.manage", "compliance.operations.read"] } } });
    const adminRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-ADMIN`, name: "Document request administrator", scope: "ORGANIZATION", permissions: { create: permissions.map(row => ({ permissionId: row.id })) } } });
    const readerRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-READER`, name: "Client reader", scope: "ORGANIZATION", permissions: { create: permissions.filter(row => row.code === "client.read").map(row => ({ permissionId: row.id })) } } });
    const [adminMembership, readerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: administratorId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: readerId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: ordinaryId, status: "ACTIVE" } }),
    ]);
    await Promise.all([
      db.membershipRole.create({ data: { membershipId: adminMembership.id, roleDefinitionId: adminRole.id } }),
      db.membershipRole.create({ data: { membershipId: readerMembership.id, roleDefinitionId: readerRole.id } }),
    ]);
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Request", legalLastName: "Client", dateOfBirth: new Date("1990-01-01"), email: "client@example.test", status: "ACTIVE", createdByUserId: administratorId } }); clientId = client.id;
    representativeId = (await db.clientRepresentative.create({ data: { organizationId, clientId, representativeType: "GUARDIAN", name: "Authorized Guardian", relationship: "Guardian", email: "guardian@example.test", isPrimary: true } })).id;
    otherClientId = (await db.client.create({ data: { organizationId: otherOrganizationId, legalFirstName: "Foreign", legalLastName: "Client", dateOfBirth: new Date("1990-01-01"), createdByUserId: administratorId } })).id;
    const templates = await Promise.all([
      db.clientDocumentTemplate.create({ data: { organizationId, code: `${tag}-RIGHTS`, name: "Rights acknowledgment", documentType: "RIGHTS_ACKNOWLEDGMENT", versionNumber: 1, contentJson: {}, renewalPolicy: "ANNUAL", renewalWarningDays: 30 } }),
      db.clientDocumentTemplate.create({ data: { organizationId, code: `${tag}-ROI`, name: "Release of information", documentType: "ROI", versionNumber: 1, contentJson: {}, renewalPolicy: "EXPIRATION_DATE_DRIVEN", renewalWarningDays: 30 } }),
    ]); rightsTemplateId = templates[0].id; roiTemplateId = templates[1].id;
  });

  it("creates tenant-scoped requests, resolves client and representative recipients, and prevents duplicates", async () => {
    const clientRequest = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "FACE_SHEET", recipientType: "CLIENT", deliveryChannel: "EMAIL", dueAt: "2026-10-10" });
    const representativeRequest = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "INTAKE_CHECKLIST", recipientType: "REPRESENTATIVE", representativeId, deliveryChannel: "EMAIL" });
    expect(clientRequest.recipientEmail).toBe("client@example.test");
    expect(representativeRequest).toMatchObject({ representativeId, recipientName: "Authorized Guardian" });
    const duplicate = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "FACE_SHEET", recipientType: "CLIENT", deliveryChannel: "EMAIL", dueAt: "2026-10-10" });
    expect(duplicate.id).toBe(clientRequest.id);
    await expect(createDocumentRequest({ id: readerId }, organizationId, clientId, { documentType: "ROI", recipientType: "CLIENT", deliveryChannel: "MANUAL" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createDocumentRequest({ id: ordinaryId }, organizationId, clientId, { documentType: "ROI", recipientType: "CLIENT", deliveryChannel: "MANUAL" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createDocumentRequest(admin(), organizationId, otherClientId, { documentType: "ROI", recipientType: "CLIENT", deliveryChannel: "MANUAL" })).rejects.toBeInstanceOf(ResourceNotFoundError);
    const foreignRepresentative = await db.clientRepresentative.create({ data: { organizationId: otherOrganizationId, clientId: otherClientId, representativeType: "GUARDIAN", name: "Foreign", email: "foreign@example.test" } });
    await expect(createDocumentRequest(admin(), organizationId, clientId, { documentType: "ROI", recipientType: "REPRESENTATIVE", representativeId: foreignRepresentative.id, deliveryChannel: "EMAIL" })).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("sends, updates, follows up, and reconciles idempotent reminders without sensitive content", async () => {
    const request = await db.clientDocumentRequest.findFirstOrThrow({ where: { organizationId, clientId, documentType: "FACE_SHEET" } });
    await sendDocumentRequest(admin(), organizationId, clientId, request.id, email, at);
    expect((await sendDocumentRequest(admin(), organizationId, clientId, request.id, email, at)).status).toBe("OUTSTANDING");
    const followed = await Promise.all([followUpDocumentRequest(admin(), organizationId, clientId, request.id, email, new Date("2026-10-02")), followUpDocumentRequest(admin(), organizationId, clientId, request.id, email, new Date("2026-10-02"))]);
    expect(followed.every(row => row.followUpCount >= 1)).toBe(true);
    await updateDocumentRequest(admin(), organizationId, clientId, request.id, { recipientType: "REPRESENTATIVE", representativeId, dueAt: "2026-10-12" });
    await Promise.all([reconcileOrganizationNotifications(admin(), organizationId, at), reconcileOrganizationNotifications(admin(), organizationId, at)]);
    expect(await db.notification.count({ where: { organizationId, sourceType: "ClientDocumentRequest", sourceId: request.id, status: "ACTIVE" } })).toBe(1);
    const audits = await db.auditEvent.findMany({ where: { organizationId, entityId: request.id } });
    expect(audits.map(row => row.eventType)).toEqual(expect.arrayContaining(["client.document_request_sent", "client.document_request_follow_up_sent", "client.document_request_recipient_changed", "client.document_request_due_date_changed"]));
    expect(JSON.stringify(audits)).not.toContain("guardian@example.test");
  });

  it("uses authoritative renewal deadlines and enriches rather than duplicates the Action Center obligation", async () => {
    const source = await db.clientDocument.create({ data: { organizationId, clientId, templateId: roiTemplateId, documentType: "ROI", status: "COMPLETED", snapshotJson: {}, generatedByUserId: administratorId, authoritativeCompletedAt: new Date("2025-10-10") } });
    await db.roiAuthorization.create({ data: { organizationId, clientId, documentId: source.id, direction: "BOTH", recipientName: "County", categories: [], purposes: [], effectiveDate: new Date("2025-10-10"), expirationDate: new Date("2026-10-10"), status: "ACTIVE" } });
    const request = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "ROI", recipientType: "CLIENT", deliveryChannel: "MANUAL", obligationDocumentId: source.id, dueAt: "2099-01-01" });
    expect(request.dueAt?.toISOString().slice(0, 10)).toBe("2026-10-10");
    await expect(updateDocumentRequest(admin(), organizationId, clientId, request.id, { dueAt: "2026-11-01" })).rejects.toBeInstanceOf(AuthorizationError);
    await sendDocumentRequest(admin(), organizationId, clientId, request.id, email, at);
    const actionCenter = await getActionCenter(admin(), organizationId, {}, at), renewal = actionCenter.clientDocumentRenewals.find(row => row.documentId === source.id)!;
    expect(renewal.requests.map(row => row.requestId)).toContain(request.id);
    expect(actionCenter.clientDocumentRequests.some(row => row.requestId === request.id)).toBe(false);
    expect(renewal.requests[0].actionHref).toContain(`requestId=${request.id}`);
  });

  it("fulfills only the linked request through the existing document workflow and resolves reminders", async () => {
    const [target, unrelated] = await Promise.all([
      createDocumentRequest(admin(), organizationId, clientId, { documentType: "RIGHTS_ACKNOWLEDGMENT", recipientType: "REPRESENTATIVE", representativeId, deliveryChannel: "SIGN_NOW" }),
      createDocumentRequest(admin(), organizationId, clientId, { documentType: "ROI", recipientType: "REPRESENTATIVE", representativeId, deliveryChannel: "MANUAL" }),
    ]);
    await Promise.all([sendDocumentRequest(admin(), organizationId, clientId, target.id, email, at), sendDocumentRequest(admin(), organizationId, clientId, unrelated.id, email, at)]);
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const document = await db.clientDocument.create({ data: { organizationId, clientId, templateId: rightsTemplateId, documentType: "RIGHTS_ACKNOWLEDGMENT", status: "READY_FOR_SIGNATURE", snapshotJson: {}, renderedPdf: Buffer.from(bytes), generatedByUserId: administratorId, finalizedAt: at } });
    await linkDocumentRequestFulfillment(admin(), organizationId, clientId, target.id, document.id);
    await linkDocumentRequestFulfillment(admin(), organizationId, clientId, target.id, document.id);
    expect(await db.auditEvent.count({ where: { organizationId, entityId: target.id, eventType: "client.document_request_document_linked" } })).toBe(1);
    const envelope = await createSignatureEnvelope(admin(), organizationId, clientId, document.id, "SIGN_NOW", [{ role: "CLIENT", name: "Request Client" }, { role: "ORGANIZATION_STAFF", name: "Staff" }]);
    await recordLocalTestSignature(admin(), organizationId, clientId, envelope.id, envelope.signers[0].id);
    await recordLocalTestSignature(admin(), organizationId, clientId, envelope.id, envelope.signers[1].id);
    expect((await db.clientDocumentRequest.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("FULFILLED");
    expect((await db.clientDocumentRequest.findUniqueOrThrow({ where: { id: unrelated.id } })).status).toBe("OUTSTANDING");
    await reconcileOrganizationNotifications(admin(), organizationId, at);
    expect(await db.notification.count({ where: { organizationId, sourceType: "ClientDocumentRequest", sourceId: target.id, status: "ACTIVE" } })).toBe(0);
    const fulfilledAudits = await db.auditEvent.count({ where: { organizationId, entityId: target.id, eventType: "client.document_request_fulfilled" } });
    await recordLocalTestSignature(admin(), organizationId, clientId, envelope.id, envelope.signers[1].id);
    expect(await db.auditEvent.count({ where: { organizationId, entityId: target.id, eventType: "client.document_request_fulfilled" } })).toBe(fulfilledAudits);
  });

  it("cancels and supersedes historically without satisfying an underlying obligation", async () => {
    const canceled = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "RIGHTS_ACKNOWLEDGMENT", recipientType: "CLIENT", deliveryChannel: "MANUAL" });
    await cancelDocumentRequest(admin(), organizationId, clientId, canceled.id);
    const replacement = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "RIGHTS_ACKNOWLEDGMENT", recipientType: "CLIENT", deliveryChannel: "MANUAL" });
    const superseding = await createDocumentRequest(admin(), organizationId, clientId, { documentType: "RIGHTS_ACKNOWLEDGMENT", recipientType: "REPRESENTATIVE", representativeId, deliveryChannel: "MANUAL", supersedesRequestId: replacement.id });
    expect((await db.clientDocumentRequest.findUniqueOrThrow({ where: { id: canceled.id } })).fulfilledAt).toBeNull();
    expect((await db.clientDocumentRequest.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe("SUPERSEDED");
    expect(superseding.supersedesRequestId).toBe(replacement.id);
    expect((await listDocumentRequests({ id: readerId }, organizationId, clientId)).map(row => row.id)).toEqual(expect.arrayContaining([canceled.id, replacement.id, superseding.id]));
    await expect(listDocumentRequests(admin(), otherOrganizationId, clientId)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
