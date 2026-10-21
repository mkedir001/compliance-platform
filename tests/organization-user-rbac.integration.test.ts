import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { getBillingAccess, getAxisCareClientMatches } from "@/domain/billing/service";
import { claimOrganizationInvitation, inviteOrganizationUser, updateOrganizationMembership } from "@/domain/organization-users/service";
import { requireEmployeeSelfAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { getAssignedClientCareViews } from "@/domain/portal/service";

const db = new PrismaClient();
const tag = `org-rbac-${Date.now()}`;
let organizationId = "", ownerId = "", ownerMembershipId = "", adminId = "", adminMembershipId = "", employeeId = "", employeeUserId = "", assignedClientId = "", unassignedClientId = "";
const account = (id: string) => ({ id });

beforeAll(async () => {
  const [organization, owner, admin, caregiver] = await Promise.all([
    db.organization.create({ data: { legalName: tag, displayName: "Synthetic RBAC Organization", slug: tag } }),
    db.user.create({ data: { email: `owner-${tag}@example.test`, status: "ACTIVE" } }),
    db.user.create({ data: { email: `admin-${tag}@example.test`, status: "ACTIVE" } }),
    db.user.create({ data: { email: `caregiver-${tag}@example.test`, status: "ACTIVE" } }),
  ]);
  organizationId = organization.id; ownerId = owner.id; adminId = admin.id; employeeUserId = caregiver.id;
  const ownerRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER", isPlatformStandard: true } });
  const adminRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-ADMIN`, name: "Delegated administrator", scope: "ORGANIZATION" } });
  const billingRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "BILLING_VIEWER", isPlatformStandard: true } });
  const caregiverRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "EMPLOYEE_CAREGIVER", isPlatformStandard: true } });
  const managementPermissions = await db.permission.findMany({ where: { code: { in: ["organization.read", "user.read", "user.invite", "user.manage", "permission.manage", "billing.view"] } } });
  await db.rolePermission.createMany({ data: managementPermissions.map(permission => ({ roleDefinitionId: adminRole.id, permissionId: permission.id })) });
  const [ownerMembership, adminMembership] = await Promise.all([
    db.organizationMembership.create({ data: { organizationId, userId: owner.id, status: "ACTIVE", joinedAt: new Date(), roles: { create: { roleDefinitionId: ownerRole.id } } } }),
    db.organizationMembership.create({ data: { organizationId, userId: admin.id, status: "ACTIVE", joinedAt: new Date(), roles: { create: [{ roleDefinitionId: adminRole.id }, { roleDefinitionId: billingRole.id }] } } }),
    db.organizationMembership.create({ data: { organizationId, userId: caregiver.id, status: "ACTIVE", joinedAt: new Date(), roles: { create: { roleDefinitionId: caregiverRole.id } } } }),
  ]);
  ownerMembershipId = ownerMembership.id; adminMembershipId = adminMembership.id;
  const employee = await db.employee.create({ data: { organizationId, userId: caregiver.id, firstName: "Synthetic", lastName: "Caregiver", email: caregiver.email, employmentStatus: "ACTIVE" } });
  employeeId = employee.id;
  const [assigned, unassigned] = await Promise.all([
    db.client.create({ data: { organizationId, createdByUserId: owner.id, legalFirstName: "Assigned", legalLastName: "Client", maPmiNumber: "SECRET-NOT-PROJECTED", addressLine1: "100 Synthetic Way", supportNeeds: "Follow the approved communication plan.", healthProfile: { create: { organizationId, allergiesReactions: "Synthetic allergy", medicareNumber: "RESTRICTED" } }, medications: { create: { organizationId, medication: "Synthetic medication", dose: "One unit" } } } }),
    db.client.create({ data: { organizationId, createdByUserId: owner.id, legalFirstName: "Unassigned", legalLastName: "Client" } }),
  ]);
  assignedClientId = assigned.id; unassignedClientId = unassigned.id;
  await db.serviceAssignment.createMany({ data: [
    { organizationId, employeeId, serviceRecipientRef: assigned.id, startsAt: new Date(Date.now() - 3600_000), status: "ACTIVE", createdByUserId: owner.id },
    { organizationId, employeeId, serviceRecipientRef: unassigned.id, startsAt: new Date(Date.now() - 7 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000), status: "ACTIVE", createdByUserId: owner.id },
  ] });
});

afterAll(async () => { await db.$disconnect(); });

describe("organization user management and effective permissions", () => {
  it("applies explicit restrictions after role grants", async () => {
    const permission = await db.permission.findUniqueOrThrow({ where: { code: "billing.view" } });
    await db.membershipPermission.create({ data: { membershipId: adminMembershipId, permissionId: permission.id, effect: "DENY", grantedByUserId: ownerId } });
    expect(await resolvePermissionCodes(adminMembershipId)).not.toContain("billing.view");
    await expect(requirePermission(adminMembershipId, "billing.view")).rejects.toBeInstanceOf(AuthorizationError);
    await db.membershipPermission.delete({ where: { membershipId_permissionId: { membershipId: adminMembershipId, permissionId: permission.id } } });
  });

  it("separates billing visibility from initiation and mapping", async () => {
    const access = await getBillingAccess(account(adminId), organizationId);
    expect(access).toMatchObject({ canView: true, canInitiate: false, canManageMapping: false, canManageSync: false });
    await expect(getAxisCareClientMatches(account(adminId), organizationId)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("prevents self escalation and removal of the last active owner", async () => {
    const ownerRole = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } });
    await expect(updateOrganizationMembership(account(adminId), organizationId, adminMembershipId, { action: "SET_ROLE", roleDefinitionId: ownerRole.id })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateOrganizationMembership(account(ownerId), organizationId, ownerMembershipId, { action: "SET_STATUS", status: "SUSPENDED" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.organizationMembership.count({ where: { organizationId, status: "ACTIVE", roles: { some: { roleDefinition: { code: "ORGANIZATION_OWNER" } } } } })).toBe(1);
  });

  it("claims a tenant-scoped invitation without increasing the inviter's authority", async () => {
    const billingViewer = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "BILLING_VIEWER" } }), email = `invited-${tag}@example.test`;
    const delivery = { name: "mailgun-test", configured: true, send: async () => ({ messageId: "synthetic-message", acceptedAt: new Date(), provider: "mailgun-test" }) };
    const created = await inviteOrganizationUser(account(ownerId), organizationId, { displayName: "Invited Viewer", email, roleDefinitionId: billingViewer.id, permissionCodes: [] }, delivery);
    expect(created.claimToken).toBeTruthy();
    const claimed = await claimOrganizationInvitation({ subject: `subject-${tag}`, email, emailVerified: true }, created.claimToken!);
    const permissions = await resolvePermissionCodes(claimed.membershipId);
    expect(permissions).toContain("billing.view"); expect(permissions).not.toContain("billing.initiate"); expect(permissions).not.toContain("billing.mapping.manage");
    await expect(claimOrganizationInvitation({ subject: `subject-${tag}`, email, emailVerified: true }, created.claimToken!)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe("employee self and assigned-client access", () => {
  it("projects only current assigned-client work information", async () => {
    const clients = await getAssignedClientCareViews(account(employeeUserId), organizationId);
    expect(clients.map(client => client.id)).toEqual([assignedClientId]);
    expect(JSON.stringify(clients)).not.toContain(unassignedClientId);
    expect(JSON.stringify(clients)).not.toContain("SECRET-NOT-PROJECTED");
    expect(JSON.stringify(clients)).not.toContain("RESTRICTED");
    expect(clients[0].medication).toMatchObject({ administrationAuthorized: false });
  });

  it("rejects another employee and revokes assignment access with employment status", async () => {
    const other = await db.employee.create({ data: { organizationId, firstName: "Other", lastName: "Employee", employmentStatus: "ACTIVE" } });
    await expect(requireEmployeeSelfAccess(account(employeeUserId), organizationId, other.id)).rejects.toBeInstanceOf(AuthorizationError);
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "TERMINATED" } });
    await expect(getAssignedClientCareViews(account(employeeUserId), organizationId)).rejects.toBeInstanceOf(AuthorizationError);
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "ACTIVE" } });
  });
});
