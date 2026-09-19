import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { EmailDeliveryError, type EmailProvider } from "@/domain/notifications/email";
import {
  getNotificationOperations,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  processEmailDeliveries,
  reconcileOrganizationNotifications,
  updateNotificationPreference,
} from "@/domain/notifications/service";

const db = new PrismaClient();

describe.sequential("Phase 21 compliance notification operations", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let adminId: string;
  let clinicianId: string;
  let employeeUserId: string;
  let otherEmployeeUserId: string;
  let employeeId: string;
  let dueAssignmentId: string;
  let noDueAssignmentId: string;
  let genericIssueId: string;
  let clinicalIssueId: string;
  const now = new Date("2026-09-19T12:00:00.000Z");

  beforeAll(async () => {
    const tag = `phase21-${Date.now()}`;
    const [organization, otherOrganization, admin, clinician, employeeUser, otherEmployeeUser] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `admin-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `clinical-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `employee-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `other-${tag}@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    adminId = admin.id;
    clinicianId = clinician.id;
    employeeUserId = employeeUser.id;
    otherEmployeeUserId = otherEmployeeUser.id;

    const employee = await db.employee.create({
      data: { organizationId, userId: employeeUserId, firstName: "Phase", lastName: "TwentyOne", employmentStatus: "ACTIVE" },
    });
    employeeId = employee.id;
    await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: employeeUserId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: otherEmployeeUserId, status: "ACTIVE" } }),
    ]);

    const permissions = await db.permission.findMany({ where: { code: { in: ["compliance.operations.read", "compliance_issue.manage", "clinical.review"] } } });
    const adminRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-ADMIN`, name: "Notification administrator", scope: "ORGANIZATION" } });
    const clinicalRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-CLINICAL`, name: "Clinical notification reviewer", scope: "ORGANIZATION" } });
    await db.rolePermission.createMany({
      data: permissions.filter((permission) => permission.code !== "clinical.review").map((permission) => ({ roleDefinitionId: adminRole.id, permissionId: permission.id })),
    });
    await db.rolePermission.createMany({
      data: permissions.filter((permission) => ["compliance.operations.read", "clinical.review"].includes(permission.code)).map((permission) => ({ roleDefinitionId: clinicalRole.id, permissionId: permission.id })),
    });
    const [adminMembership, clinicalMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: adminId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: clinicianId, status: "ACTIVE" } }),
    ]);
    await Promise.all([
      db.membershipRole.create({ data: { membershipId: adminMembership.id, roleDefinitionId: adminRole.id } }),
      db.membershipRole.create({ data: { membershipId: clinicalMembership.id, roleDefinitionId: clinicalRole.id } }),
    ]);

    const courseVersion = await db.trainingCourseVersion.findFirstOrThrow({ where: { status: "PUBLISHED" } });
    const [dueAssignment, noDueAssignment] = await Promise.all([
      db.trainingAssignment.create({ data: { fingerprint: `${tag}:due`, activeKey: `${tag}:due`, organizationId, employeeId, courseVersionId: courseVersion.id, sourceType: "MANUAL", dueAt: new Date("2026-09-25T12:00:00.000Z") } }),
      db.trainingAssignment.create({ data: { fingerprint: `${tag}:nodue`, activeKey: `${tag}:nodue`, organizationId, employeeId, courseVersionId: courseVersion.id, sourceType: "MANUAL" } }),
    ]);
    dueAssignmentId = dueAssignment.id;
    noDueAssignmentId = noDueAssignment.id;

    await Promise.all([
      db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Verified credential", status: "ACTIVE", verificationStatus: "VERIFIED", expiresAt: new Date("2026-09-28") } }),
      db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Review credential", status: "ACTIVE", verificationStatus: "UNVERIFIED" } }),
    ]);
    const issueBase = { organizationId, employeeId, priority: "HIGH" as const, status: "OPEN" as const, sourceType: "phase21", contextJson: {}, reasonCodesJson: [], remediationActionsJson: [], evidenceReferencesJson: [], firstDetectedAt: now, latestDetectedAt: now };
    const [genericIssue, clinicalIssue] = await Promise.all([
      db.complianceIssue.create({ data: { ...issueBase, fingerprint: `${tag}:generic`, activeKey: `${tag}:generic`, issueType: "CREDENTIAL_INVALID", sourceId: `${tag}:generic` } }),
      db.complianceIssue.create({ data: { ...issueBase, fingerprint: `${tag}:clinical`, activeKey: `${tag}:clinical`, issueType: "MEDICATION_AUTHORIZATION_MISSING", sourceId: `${tag}:clinical` } }),
    ]);
    genericIssueId = genericIssue.id;
    clinicalIssueId = clinicalIssue.id;
  });

  it("generates durable employee and role-specific notifications without fabricating deadlines", async () => {
    const first = await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    expect(first.created).toBeGreaterThan(0);
    const employee = await listMyNotifications({ id: employeeUserId }, organizationId, { pageSize: 100 });
    expect(employee.items.some((item) => item.sourceId === dueAssignmentId && item.notificationType === "TRAINING_DUE_SOON")).toBe(true);
    const noDue = employee.items.find((item) => item.sourceId === noDueAssignmentId);
    expect(noDue?.notificationType).toBe("TRAINING_ASSIGNED");
    expect(noDue?.dueAt).toBeNull();
    expect(employee.items.some((item) => item.notificationType === "CREDENTIAL_EXPIRING")).toBe(true);
    expect((await listMyNotifications({ id: adminId }, organizationId, { pageSize: 100 })).items.some((item) => item.sourceId === genericIssueId)).toBe(true);
    expect((await listMyNotifications({ id: adminId }, organizationId, { pageSize: 100 })).items.some((item) => item.sourceId === clinicalIssueId)).toBe(false);
    expect((await listMyNotifications({ id: clinicianId }, organizationId, { pageSize: 100 })).items.some((item) => item.sourceId === clinicalIssueId && item.audience === "CLINICAL")).toBe(true);
  });

  it("is idempotent and supports recipient-scoped read state and pagination", async () => {
    const count = await db.notification.count({ where: { organizationId } });
    expect((await reconcileOrganizationNotifications({ id: adminId }, organizationId, now)).created).toBe(0);
    expect(await db.notification.count({ where: { organizationId } })).toBe(count);
    const firstPage = await listMyNotifications({ id: employeeUserId }, organizationId, { unread: true, page: 1, pageSize: 1 });
    expect(firstPage.items).toHaveLength(1);
    await expect(markNotificationRead({ id: otherEmployeeUserId }, organizationId, firstPage.items[0].id)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await markNotificationRead({ id: employeeUserId }, organizationId, firstPage.items[0].id);
    expect((await listMyNotifications({ id: employeeUserId }, organizationId, { unread: true, pageSize: 100 })).unreadCount).toBe(firstPage.unreadCount - 1);
    await markAllNotificationsRead({ id: employeeUserId }, organizationId);
    expect((await listMyNotifications({ id: employeeUserId }, organizationId, { unread: true })).unreadCount).toBe(0);
  });

  it("escalates from authoritative overdue state and resolves stale notifications", async () => {
    await db.trainingAssignment.update({ where: { id: dueAssignmentId }, data: { dueAt: new Date("2026-09-01T12:00:00.000Z") } });
    const result = await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    expect(result.created).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { organizationId, sourceId: dueAssignmentId, notificationType: "TRAINING_OVERDUE", status: "ACTIVE" } })).toBe(1);
    expect(await db.notification.count({ where: { organizationId, sourceId: dueAssignmentId, notificationType: "TRAINING_DUE_SOON", status: "RESOLVED" } })).toBe(1);
    await db.trainingAssignment.update({ where: { id: noDueAssignmentId }, data: { status: "COMPLETED", completedAt: now, activeKey: null } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    expect(await db.notification.count({ where: { organizationId, sourceId: noDueAssignmentId, status: "RESOLVED" } })).toBeGreaterThan(0);
  });

  it("respects workforce lifecycle suppression and controlled reactivation", async () => {
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "TERMINATED" } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    expect(await db.notification.count({ where: { organizationId, recipientUserId: employeeUserId, status: "ACTIVE" } })).toBe(0);
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "ACTIVE" } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, new Date(now.getTime() + 1_000) );
    const activeAfterReactivation = await db.notification.count({ where: { organizationId, recipientUserId: employeeUserId, status: "ACTIVE" } });
    expect(activeAfterReactivation).toBeGreaterThan(0);
    expect((await reconcileOrganizationNotifications({ id: adminId }, organizationId, new Date(now.getTime() + 2_000))).created).toBe(0);
    expect(await db.notification.count({ where: { organizationId, recipientUserId: employeeUserId, status: "ACTIVE" } })).toBe(activeAfterReactivation);
  });

  it("keeps preferences optional while preserving in-app delivery", async () => {
    await updateNotificationPreference({ id: employeeUserId }, organizationId, { optionalEmailEnabled: false });
    await db.trainingAssignment.update({ where: { id: dueAssignmentId }, data: { status: "COMPLETED", completedAt: now, activeKey: null } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    const replacement = await db.trainingAssignment.create({ data: { fingerprint: `phase21-preference-${Date.now()}`, activeKey: `phase21-preference-${Date.now()}`, organizationId, employeeId, courseVersionId: (await db.trainingCourseVersion.findFirstOrThrow({ where: { status: "PUBLISHED" } })).id, sourceType: "MANUAL" } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    const notification = await db.notification.findFirstOrThrow({ where: { sourceId: replacement.id, recipientUserId: employeeUserId, status: "ACTIVE" }, include: { deliveries: true } });
    expect(notification.deliveries[0].status).toBe("SKIPPED");
    expect(notification.status).toBe("ACTIVE");
    expect(await db.auditEvent.count({ where: { organizationId, eventType: "notification.preference_changed" } })).toBe(1);
  });

  it("isolates provider failures, retries with deduplication, and records success", async () => {
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { organizationId, status: "PENDING" } });
    let attempts = 0;
    const provider: EmailProvider = {
      name: "phase21-test",
      configured: true,
      async send() {
        attempts += 1;
        if (attempts === 1) throw new EmailDeliveryError("temporary", true, "TEMPORARY");
        return { messageId: "phase21-message" };
      },
    };
    await processEmailDeliveries(organizationId, provider, now, 1);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("RETRYABLE_FAILED");
    await processEmailDeliveries(organizationId, provider, new Date(now.getTime() + 10 * 60_000), 1);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("SENT");
    expect(await db.notificationDelivery.count({ where: { notificationId: delivery.notificationId, channel: "EMAIL" } })).toBe(1);
    expect(await db.notification.count({ where: { organizationId } })).toBeGreaterThan(0);
  });

  it("preserves invitation secrecy, tenant isolation, authorization, and auditability", async () => {
    const secret = `phase21-secret-${Date.now()}`;
    await db.employeePortalInvitation.create({ data: { organizationId, employeeId, invitedEmail: "invite@example.test", tokenHash: secret, invitedByUserId: adminId } });
    await reconcileOrganizationNotifications({ id: adminId }, organizationId, now);
    expect(JSON.stringify(await db.notification.findMany({ where: { organizationId } }))).not.toContain(secret);
    expect(JSON.stringify(await db.auditEvent.findMany({ where: { organizationId } }))).not.toContain(secret);
    await expect(listMyNotifications({ id: employeeUserId }, otherOrganizationId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getNotificationOperations({ id: employeeUserId }, organizationId)).rejects.toBeInstanceOf(AuthorizationError);
    const operations = await getNotificationOperations({ id: adminId }, organizationId);
    expect(operations.liveEmailConfigured).toBe(false);
    expect(operations.notifications.length).toBeGreaterThan(0);
    const events = new Set((await db.auditEvent.findMany({ where: { organizationId } })).map((event) => event.eventType));
    expect(events.has("notification.generated")).toBe(true);
    expect(events.has("notification.escalated")).toBe(true);
  });
});
