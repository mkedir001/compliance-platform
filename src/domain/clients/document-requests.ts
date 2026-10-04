import { Prisma, type ClientDocumentRequestRecipientType, type ClientDocumentType, type User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { getClientRenewalSummary, renewalState } from "@/domain/clients/renewals";
import { configuredEmailProviderForPurpose, type EmailProvider } from "@/domain/notifications/email";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

const activeStatuses = ["DRAFT", "SENT", "OUTSTANDING"] as const;
export const documentRequestInput = z.object({
  documentType: z.enum(["INTAKE_CHECKLIST", "FACE_SHEET", "RIGHTS_ACKNOWLEDGMENT", "ROI"]),
  recipientType: z.enum(["CLIENT", "REPRESENTATIVE"]),
  representativeId: z.string().cuid().optional(),
  deliveryChannel: z.enum(["EMAIL", "MANUAL", "SIGN_NOW"]),
  dueAt: z.coerce.date().optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
  obligationDocumentId: z.string().cuid().optional().nullable(),
  supersedesRequestId: z.string().cuid().optional().nullable(),
}).strict();
const documentRequestUpdateInput = z.object({
  recipientType: z.enum(["CLIENT", "REPRESENTATIVE"]).optional(),
  representativeId: z.string().cuid().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
}).strict();

async function authorize(user: Pick<User, "id">, organizationId: string, permission: string) { const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, permission); }
async function audit(organizationId: string, actorUserId: string | null, eventType: string, requestId: string, metadataJson?: Prisma.InputJsonValue) { await prisma.auditEvent.create({ data: { organizationId, actorUserId, eventType, entityType: "ClientDocumentRequest", entityId: requestId, metadataJson } }); }
async function requestOrThrow(organizationId: string, clientId: string, requestId: string) { const request = await prisma.clientDocumentRequest.findFirst({ where: { id: requestId, organizationId, clientId }, include: { representative: true, obligationDocument: true, fulfilledDocument: true } }); if (!request) throw new ResourceNotFoundError("Document request not found"); return request; }

async function resolveRecipient(organizationId: string, clientId: string, type: ClientDocumentRequestRecipientType, representativeId?: string) {
  if (type === "CLIENT") { const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { legalFirstName: true, legalLastName: true, email: true } }); if (!client) throw new ResourceNotFoundError("Client not found"); return { representativeId: null, name: `${client.legalFirstName} ${client.legalLastName}`, email: client.email }; }
  if (!representativeId) throw new AuthorizationError("A client representative is required");
  const representative = await prisma.clientRepresentative.findFirst({ where: { id: representativeId, organizationId, clientId }, select: { id: true, name: true, email: true } });
  if (!representative) throw new ResourceNotFoundError("Client representative not found");
  return { representativeId: representative.id, name: representative.name, email: representative.email };
}

async function requestDefinition(user: Pick<User, "id">, organizationId: string, clientId: string, input: z.infer<typeof documentRequestInput>) {
  const recipient = await resolveRecipient(organizationId, clientId, input.recipientType, input.representativeId);
  let dueAt = input.dueAt ?? null, templateId: string | null = null;
  if (input.obligationDocumentId) {
    const obligation = await prisma.clientDocument.findFirst({ where: { id: input.obligationDocumentId, organizationId, clientId }, select: { id: true, documentType: true, templateId: true } });
    if (!obligation) throw new ResourceNotFoundError("Document obligation not found");
    if (obligation.documentType !== input.documentType) throw new AuthorizationError("Requested document type does not match the obligation");
    const cycle = (await getClientRenewalSummary(user, organizationId, clientId)).cycles.find(row => row.documentId === obligation.id);
    if (!cycle || cycle.status === "CURRENT") throw new AuthorizationError("Document does not currently have an actionable renewal obligation");
    dueAt = new Date(`${cycle.dueDate}T00:00:00.000Z`); templateId = obligation.templateId;
  } else {
    templateId = (await prisma.clientDocumentTemplate.findFirst({ where: { documentType: input.documentType, status: "ACTIVE", OR: [{ organizationId }, { organizationId: null }] }, orderBy: [{ organizationId: "desc" }, { versionNumber: "desc" }], select: { id: true } }))?.id ?? null;
  }
  if (input.deliveryChannel === "EMAIL" && !recipient.email) throw new AuthorizationError("Selected recipient does not have an email address");
  const obligationKey = input.obligationDocumentId ?? `type:${input.documentType}`, recipientKey = recipient.representativeId ?? "client";
  return { recipient, dueAt, templateId, activeKey: [organizationId, clientId, obligationKey, input.recipientType, recipientKey].join(":") };
}

export async function createDocumentRequest(user: Pick<User, "id">, organizationId: string, clientId: string, raw: unknown) {
  await authorize(user, organizationId, "client.document.generate"); const input = documentRequestInput.parse(raw), definition = await requestDefinition(user, organizationId, clientId, input);
  try {
    const request = await prisma.$transaction(async tx => {
      if (input.supersedesRequestId) { const prior = await tx.clientDocumentRequest.findFirst({ where: { id: input.supersedesRequestId, organizationId, clientId, status: { in: [...activeStatuses] } } }); if (!prior) throw new ResourceNotFoundError("Active document request to supersede not found"); await tx.clientDocumentRequest.update({ where: { id: prior.id }, data: { status: "SUPERSEDED", activeKey: null, supersededAt: new Date() } }); }
      return tx.clientDocumentRequest.create({ data: { organizationId, clientId, templateId: definition.templateId, documentType: input.documentType, recipientType: input.recipientType, representativeId: definition.recipient.representativeId, recipientName: definition.recipient.name, recipientEmail: definition.recipient.email, deliveryChannel: input.deliveryChannel, dueAt: definition.dueAt, staffNote: input.staffNote, obligationDocumentId: input.obligationDocumentId, supersedesRequestId: input.supersedesRequestId, activeKey: definition.activeKey, createdByUserId: user.id } });
    });
    if (input.supersedesRequestId) await audit(organizationId, user.id, "client.document_request_superseded", input.supersedesRequestId, { supersededByRequestId: request.id, clientId });
    await audit(organizationId, user.id, "client.document_request_created", request.id, { clientId, documentType: request.documentType, recipientType: request.recipientType, deliveryChannel: request.deliveryChannel, obligationDocumentId: request.obligationDocumentId, supersedesRequestId: request.supersedesRequestId }); return request;
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.clientDocumentRequest.findUniqueOrThrow({ where: { activeKey: definition.activeKey } }); throw error; }
}

export async function listDocumentRequests(user: Pick<User, "id">, organizationId: string, clientId: string) { await authorize(user, organizationId, "client.read"); return prisma.clientDocumentRequest.findMany({ where: { organizationId, clientId }, include: { representative: { select: { id: true, representativeType: true, relationship: true } }, obligationDocument: { select: { id: true, documentType: true } }, fulfilledDocument: { select: { id: true, documentType: true, status: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 }); }

export async function updateDocumentRequest(user: Pick<User, "id">, organizationId: string, clientId: string, requestId: string, raw: unknown) {
  await authorize(user, organizationId, "client.document.generate");
  const input = documentRequestUpdateInput.parse(raw), request = await requestOrThrow(organizationId, clientId, requestId);
  if (![...activeStatuses].includes(request.status as typeof activeStatuses[number])) throw new AuthorizationError("Only an active document request can be updated");
  const recipientType = input.recipientType ?? request.recipientType;
  const representativeId = input.representativeId === undefined ? request.representativeId ?? undefined : input.representativeId ?? undefined;
  const recipient = await resolveRecipient(organizationId, clientId, recipientType, representativeId);
  if (request.deliveryChannel === "EMAIL" && !recipient.email) throw new AuthorizationError("Selected recipient does not have an email address");
  if (request.obligationDocumentId && input.dueAt !== undefined) throw new AuthorizationError("A renewal-linked request uses its authoritative renewal deadline");
  const recipientChanged = recipientType !== request.recipientType || recipient.representativeId !== request.representativeId;
  const dueAt = input.dueAt === undefined ? request.dueAt : input.dueAt;
  const dueChanged = (dueAt?.getTime() ?? null) !== (request.dueAt?.getTime() ?? null);
  const obligationKey = request.obligationDocumentId ?? `type:${request.documentType}`, recipientKey = recipient.representativeId ?? "client";
  const updated = await prisma.clientDocumentRequest.update({ where: { id: request.id }, data: { recipientType, representativeId: recipient.representativeId, recipientName: recipient.name, recipientEmail: recipient.email, dueAt, staffNote: input.staffNote === undefined ? request.staffNote : input.staffNote, activeKey: [organizationId, clientId, obligationKey, recipientType, recipientKey].join(":") } });
  if (recipientChanged) await audit(organizationId, user.id, "client.document_request_recipient_changed", request.id, { clientId, recipientType });
  if (dueChanged) await audit(organizationId, user.id, "client.document_request_due_date_changed", request.id, { clientId, dueAt: dueAt?.toISOString() ?? null });
  return updated;
}

function minimalMessage(documentType: ClientDocumentType) { return { subject: "Document request from your service organization", text: `Your service organization is requesting a ${documentType.toLowerCase().replaceAll("_", " ")} document. Please use your established secure contact or signing process to respond. Do not send sensitive records through an unapproved channel.` }; }

export async function sendDocumentRequest(user: Pick<User, "id">, organizationId: string, clientId: string, requestId: string, provider: EmailProvider = configuredEmailProviderForPurpose("CLIENT_SECURE"), at = new Date()) {
  await authorize(user, organizationId, "client.document.generate"); const request = await requestOrThrow(organizationId, clientId, requestId); if (request.status !== "DRAFT") return request;
  const claimed = await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, status: "DRAFT" }, data: { status: "SENT", requestedAt: at } }); if (!claimed.count) return requestOrThrow(organizationId, clientId, request.id);
  try { if (request.deliveryChannel === "EMAIL") { if (!request.recipientEmail) throw new AuthorizationError("Request recipient has no email address"); await provider.send({ to: request.recipientEmail, ...minimalMessage(request.documentType) }); } const updated = await prisma.clientDocumentRequest.update({ where: { id: request.id }, data: { status: "OUTSTANDING", sentAt: at } }); await audit(organizationId, user.id, "client.document_request_sent", request.id, { clientId, documentType: request.documentType, deliveryChannel: request.deliveryChannel, obligationDocumentId: request.obligationDocumentId }); return updated; }
  catch (error) { await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, status: "SENT" }, data: { status: "DRAFT", requestedAt: null } }); throw error; }
}

export async function followUpDocumentRequest(user: Pick<User, "id">, organizationId: string, clientId: string, requestId: string, provider: EmailProvider = configuredEmailProviderForPurpose("CLIENT_SECURE"), at = new Date()) {
  await authorize(user, organizationId, "client.document.generate"); const request = await requestOrThrow(organizationId, clientId, requestId); if (request.status !== "OUTSTANDING") throw new AuthorizationError("Only an outstanding request can receive follow-up");
  const claimed = await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, status: "OUTSTANDING", followUpCount: request.followUpCount }, data: { followUpCount: { increment: 1 }, latestFollowUpAt: at } }); if (!claimed.count) return requestOrThrow(organizationId, clientId, request.id);
  try { if (request.deliveryChannel === "EMAIL") { if (!request.recipientEmail) throw new AuthorizationError("Request recipient has no email address"); await provider.send({ to: request.recipientEmail, ...minimalMessage(request.documentType) }); } await audit(organizationId, user.id, "client.document_request_follow_up_sent", request.id, { clientId, documentType: request.documentType, followUpNumber: request.followUpCount + 1 }); return requestOrThrow(organizationId, clientId, request.id); }
  catch (error) { await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, followUpCount: request.followUpCount + 1, latestFollowUpAt: at }, data: { followUpCount: request.followUpCount, latestFollowUpAt: request.latestFollowUpAt } }); throw error; }
}

export async function cancelDocumentRequest(user: Pick<User, "id">, organizationId: string, clientId: string, requestId: string) { await authorize(user, organizationId, "client.document.generate"); const request = await requestOrThrow(organizationId, clientId, requestId); if (![...activeStatuses].includes(request.status as typeof activeStatuses[number])) return request; const result = await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, status: { in: [...activeStatuses] } }, data: { status: "CANCELED", activeKey: null, canceledAt: new Date() } }); if (result.count) await audit(organizationId, user.id, "client.document_request_canceled", request.id, { clientId, documentType: request.documentType, obligationDocumentId: request.obligationDocumentId }); return requestOrThrow(organizationId, clientId, request.id); }

export async function linkDocumentRequestFulfillment(user: Pick<User, "id">, organizationId: string, clientId: string, requestId: string, documentId: string) { await authorize(user, organizationId, "client.document.generate"); const [request, document] = await Promise.all([requestOrThrow(organizationId, clientId, requestId), prisma.clientDocument.findFirst({ where: { id: documentId, organizationId, clientId } })]); if (!document) throw new ResourceNotFoundError("Fulfillment document not found"); if (document.documentType !== request.documentType) throw new AuthorizationError("Fulfillment document type does not match the request"); if (![...activeStatuses].includes(request.status as typeof activeStatuses[number])) return request; if (request.fulfilledDocumentId !== document.id) { await prisma.clientDocumentRequest.update({ where: { id: request.id }, data: { fulfilledDocumentId: document.id } }); await audit(organizationId, user.id, "client.document_request_document_linked", request.id, { clientId, documentId, documentType: document.documentType }); } if (document.status === "COMPLETED") await reconcileCompletedDocumentRequests(organizationId, clientId, document.id, user.id, document.authoritativeCompletedAt ?? new Date()); return requestOrThrow(organizationId, clientId, request.id); }

export async function reconcileCompletedDocumentRequests(organizationId: string, clientId: string, documentId: string, actorUserId: string | null, at = new Date()) { const requests = await prisma.clientDocumentRequest.findMany({ where: { organizationId, clientId, fulfilledDocumentId: documentId, status: { in: [...activeStatuses] } }, select: { id: true, documentType: true, obligationDocumentId: true } }); let fulfilled = 0; for (const request of requests) { const result = await prisma.clientDocumentRequest.updateMany({ where: { id: request.id, status: { in: [...activeStatuses] } }, data: { status: "FULFILLED", activeKey: null, fulfilledAt: at } }); if (!result.count) continue; fulfilled += result.count; await audit(organizationId, actorUserId, "client.document_request_fulfilled", request.id, { clientId, documentId, documentType: request.documentType, obligationDocumentId: request.obligationDocumentId }); } return { fulfilled }; }

export async function getOrganizationDocumentRequestActions(organizationId: string, at = new Date()) { const [organization, rows] = await Promise.all([prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }), prisma.clientDocumentRequest.findMany({ where: { organizationId, status: { in: ["SENT", "OUTSTANDING"] } }, include: { client: { select: { id: true, legalFirstName: true, legalLastName: true } }, template: { select: { name: true } } }, orderBy: [{ dueAt: "asc" }, { requestedAt: "asc" }, { id: "asc" }], take: 1000 })]); return rows.map(request => { const temporal = request.dueAt ? renewalState(request.dueAt, 30, at, organization?.timezone ?? "UTC") : null; return { id: `client-document-request:${request.id}`, requestId: request.id, client: request.client, documentType: request.documentType, documentName: request.template?.name ?? request.documentType.toLowerCase().replaceAll("_", " "), recipientName: request.recipientName, status: request.status, requestedAt: request.requestedAt?.toISOString() ?? request.createdAt.toISOString(), dueAt: request.dueAt?.toISOString() ?? null, daysUntilDue: temporal?.days ?? null, deadlineState: !temporal ? "NO_DEADLINE" as const : temporal.status === "OVERDUE" ? "OVERDUE" as const : temporal.status === "DUE_SOON" ? "DUE_SOON" as const : "FUTURE" as const, latestFollowUpAt: request.latestFollowUpAt?.toISOString() ?? null, followUpCount: request.followUpCount, obligationDocumentId: request.obligationDocumentId, actionHref: `/admin/clients?organizationId=${encodeURIComponent(organizationId)}&clientId=${encodeURIComponent(request.clientId)}&requestId=${encodeURIComponent(request.id)}` }; }); }
