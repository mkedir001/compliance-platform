import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { getActionCenter } from "@/domain/action-center/service";
import { getClient } from "@/domain/clients/service";
import { listMyNotifications, markNotificationRead, reconcileOrganizationNotifications } from "@/domain/notifications/service";

const db = new PrismaClient();

describe.sequential("client document renewal notifications", () => {
  const at = new Date("2026-10-01T12:00:00.000Z");
  let organizationId: string;
  let otherOrganizationId: string;
  let administratorId: string;
  let readOnlyUserId: string;
  let ordinaryUserId: string;
  let clientId: string;
  let approachingId: string;
  let dueSoonId: string;
  let dueTodayId: string;
  let overdueId: string;

  async function renewableRoi(templateId: string, expirationDate: string, targetClientId = clientId) {
    const document = await db.clientDocument.create({ data: { organizationId, clientId: targetClientId, templateId, documentType: "ROI", status: "COMPLETED", snapshotJson: {}, generatedByUserId: administratorId, authoritativeCompletedAt: new Date("2026-01-01T12:00:00.000Z") } });
    await db.roiAuthorization.create({ data: { organizationId, clientId: targetClientId, documentId: document.id, direction: "BOTH", recipientName: "Authorized recipient", categories: [], purposes: [], effectiveDate: new Date("2026-01-01"), expirationDate: new Date(expirationDate), status: "ACTIVE" } });
    return document.id;
  }

  beforeAll(async () => {
    const tag = `renewal-notifications-${Date.now()}`;
    const [organization, otherOrganization, administrator, readOnly, ordinary] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag, timezone: "UTC" } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other`, timezone: "UTC" } }),
      db.user.create({ data: { email: `${tag}-administrator@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-reader@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-ordinary@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    administratorId = administrator.id;
    readOnlyUserId = readOnly.id;
    ordinaryUserId = ordinary.id;

    const permissions = await db.permission.findMany({ where: { code: { in: ["compliance.operations.read", "client.read", "client.document.generate"] } } });
    const administratorRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-RENEWAL-ADMIN`, name: "Renewal administrator", scope: "ORGANIZATION", permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    const readerRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-RENEWAL-READER`, name: "Renewal reader", scope: "ORGANIZATION", permissions: { create: permissions.filter(permission => permission.code === "client.read").map(permission => ({ permissionId: permission.id })) } } });
    const [administratorMembership, readerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: administratorId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: readOnlyUserId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: ordinaryUserId, status: "ACTIVE" } }),
    ]);
    await Promise.all([
      db.membershipRole.create({ data: { membershipId: administratorMembership.id, roleDefinitionId: administratorRole.id } }),
      db.membershipRole.create({ data: { membershipId: readerMembership.id, roleDefinitionId: readerRole.id } }),
    ]);

    clientId = (await db.client.create({ data: { organizationId, legalFirstName: "Renewal", legalLastName: "Client", dateOfBirth: new Date("1990-01-01"), status: "ACTIVE", createdByUserId: administratorId } })).id;
    const templates = await Promise.all(["APPROACHING", "DUE-SOON", "DUE-TODAY", "OVERDUE"].map(code => db.clientDocumentTemplate.create({ data: { organizationId, code: `${tag}-${code}`, name: `Renewal ${code.toLowerCase()}`, documentType: "ROI", versionNumber: 1, contentJson: {}, renewalPolicy: "EXPIRATION_DATE_DRIVEN", renewalWarningDays: 30 } })));
    approachingId = await renewableRoi(templates[0].id, "2026-10-25");
    dueSoonId = await renewableRoi(templates[1].id, "2026-10-06");
    dueTodayId = await renewableRoi(templates[2].id, "2026-10-01");
    overdueId = await renewableRoi(templates[3].id, "2026-09-30");

    const otherClient = await db.client.create({ data: { organizationId: otherOrganizationId, legalFirstName: "Other", legalLastName: "Tenant", dateOfBirth: new Date("1990-01-01"), createdByUserId: administratorId } });
    const otherTemplate = await db.clientDocumentTemplate.create({ data: { organizationId: otherOrganizationId, code: `${tag}-OTHER`, name: "Other tenant renewal", documentType: "ROI", versionNumber: 1, contentJson: {}, renewalPolicy: "EXPIRATION_DATE_DRIVEN", renewalWarningDays: 30 } });
    const otherDocument = await db.clientDocument.create({ data: { organizationId: otherOrganizationId, clientId: otherClient.id, templateId: otherTemplate.id, documentType: "ROI", status: "COMPLETED", snapshotJson: {}, generatedByUserId: administratorId, authoritativeCompletedAt: new Date("2026-01-01") } });
    await db.roiAuthorization.create({ data: { organizationId: otherOrganizationId, clientId: otherClient.id, documentId: otherDocument.id, direction: "BOTH", recipientName: "Other", categories: [], purposes: [], effectiveDate: new Date("2026-01-01"), expirationDate: new Date("2026-10-01"), status: "ACTIVE" } });
  });

  it("creates permission-scoped approaching, due-soon, due-today, and overdue notifications without duplicates", async () => {
    const concurrent = await Promise.allSettled([
      reconcileOrganizationNotifications({ id: administratorId }, organizationId, at),
      reconcileOrganizationNotifications({ id: administratorId }, organizationId, at),
    ]);
    expect(concurrent.every(result => result.status === "fulfilled")).toBe(true);
    const notifications = await db.notification.findMany({ where: { organizationId, sourceType: "ClientDocumentRenewal", status: "ACTIVE" } });
    expect(notifications).toHaveLength(4);
    expect(new Map(notifications.map(item => [item.sourceId, item.notificationType]))).toEqual(new Map([
      [approachingId, "CLIENT_DOCUMENT_RENEWAL_APPROACHING"],
      [dueSoonId, "CLIENT_DOCUMENT_RENEWAL_DUE_SOON"],
      [dueTodayId, "CLIENT_DOCUMENT_RENEWAL_DUE_TODAY"],
      [overdueId, "CLIENT_DOCUMENT_RENEWAL_OVERDUE"],
    ]));
    expect(notifications.find(item => item.sourceId === overdueId)).toMatchObject({ severity: "ESCALATED", escalationLevel: 1 });
    expect(notifications.every(item => item.recipientUserId === administratorId)).toBe(true);
    expect(notifications.every(item => item.actionHref?.includes(`clientId=${clientId}`) && item.actionHref.includes(`documentId=${item.sourceId}`))).toBe(true);
    expect(await db.notification.count({ where: { organizationId, recipientUserId: readOnlyUserId, sourceType: "ClientDocumentRenewal" } })).toBe(0);
    const auditCount = await db.auditEvent.count({ where: { organizationId, entityType: "Notification", eventType: { in: ["notification.generated", "notification.escalated"] } } });
    await reconcileOrganizationNotifications({ id: administratorId }, organizationId, at);
    expect(await db.notification.count({ where: { organizationId, sourceType: "ClientDocumentRenewal", status: "ACTIVE" } })).toBe(4);
    expect(await db.auditEvent.count({ where: { organizationId, entityType: "Notification", eventType: { in: ["notification.generated", "notification.escalated"] } } })).toBe(auditCount);
  });

  it("replaces a changed deadline and resolves completion or cancellation at obligation scope", async () => {
    await db.roiAuthorization.update({ where: { documentId: dueSoonId }, data: { expirationDate: new Date("2026-10-07") } });
    await reconcileOrganizationNotifications({ id: administratorId }, organizationId, at);
    const changed = await db.notification.findFirstOrThrow({ where: { organizationId, sourceId: dueSoonId, status: "ACTIVE" } });
    expect(changed.dueAt?.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(changed.title).toContain("Renewal deadline changed");
    expect(await db.notification.count({ where: { organizationId, sourceId: dueSoonId, status: "RESOLVED" } })).toBe(1);

    const source = await db.clientDocument.findUniqueOrThrow({ where: { id: dueSoonId } });
    const replacement = await db.clientDocument.create({ data: { organizationId, clientId, templateId: source.templateId, documentType: "ROI", status: "COMPLETED", snapshotJson: {}, generatedByUserId: administratorId, authoritativeCompletedAt: new Date("2026-10-02T12:00:00.000Z"), renewalOfDocumentId: dueSoonId } });
    await db.roiAuthorization.create({ data: { organizationId, clientId, documentId: replacement.id, direction: "BOTH", recipientName: "Authorized recipient", categories: [], purposes: [], effectiveDate: new Date("2026-10-02"), expirationDate: new Date("2027-10-02"), status: "ACTIVE" } });
    await db.roiAuthorization.update({ where: { documentId: dueTodayId }, data: { status: "REVOKED", revokedAt: at, revocationReason: "Requirement removed by authorized workflow" } });
    const result = await reconcileOrganizationNotifications({ id: administratorId }, organizationId, at);
    expect(result.resolved).toBeGreaterThanOrEqual(2);
    expect(await db.notification.count({ where: { organizationId, sourceId: { in: [dueSoonId, dueTodayId] }, status: "ACTIVE" } })).toBe(0);
    expect(await db.notification.count({ where: { organizationId, sourceId: { in: [approachingId, overdueId] }, status: "ACTIVE" } })).toBe(2);
    const actionCenter = await getActionCenter({ id: administratorId }, organizationId, {}, at);
    expect(actionCenter.clientDocumentRenewals.map(item => item.documentId)).toEqual(expect.arrayContaining([approachingId, overdueId]));
    expect(actionCenter.clientDocumentRenewals.some(item => [dueSoonId, dueTodayId].includes(item.documentId))).toBe(false);
    const resolvedAuditCount = await db.auditEvent.count({ where: { organizationId, eventType: "notification.resolved", entityType: "Notification" } });
    await reconcileOrganizationNotifications({ id: administratorId }, organizationId, at);
    expect(await db.auditEvent.count({ where: { organizationId, eventType: "notification.resolved", entityType: "Notification" } })).toBe(resolvedAuditCount);
  });

  it("enforces tenant, recipient, and client authorization boundaries", async () => {
    const administratorNotifications = await listMyNotifications({ id: administratorId }, organizationId, { pageSize: 100 });
    expect(administratorNotifications.items.some(item => item.sourceType === "ClientDocumentRenewal")).toBe(true);
    expect((await listMyNotifications({ id: ordinaryUserId }, organizationId, { pageSize: 100 })).items).toHaveLength(0);
    await expect(listMyNotifications({ id: ordinaryUserId }, otherOrganizationId)).rejects.toBeInstanceOf(AuthorizationError);
    const protectedNotification = administratorNotifications.items.find(item => item.sourceType === "ClientDocumentRenewal")!;
    await expect(markNotificationRead({ id: ordinaryUserId }, organizationId, protectedNotification.id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(getClient({ id: ordinaryUserId }, organizationId, clientId)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.notification.count({ where: { organizationId, sourceType: "ClientDocumentRenewal", message: { contains: "Other Tenant" } } })).toBe(0);
  });
});
