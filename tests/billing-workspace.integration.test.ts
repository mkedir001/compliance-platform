import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getBillingWorkspaceClients } from "@/domain/billing/service";

const db = new PrismaClient();

describe.sequential("organization billing workspace", () => {
  let organizationId = "", otherOrganizationId = "", managerId = "", viewerId = "";

  beforeAll(async () => {
    const tag = `billing-workspace-${Date.now()}`;
    const [organization, otherOrganization, manager, viewer, permission] = await Promise.all([
      db.organization.create({ data: { legalName: `${tag} A`, displayName: `${tag} A`, slug: `${tag}-a` } }),
      db.organization.create({ data: { legalName: `${tag} B`, displayName: `${tag} B`, slug: `${tag}-b` } }),
      db.user.create({ data: { email: `manager-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `viewer-${tag}@example.test`, status: "ACTIVE" } }),
      db.permission.upsert({ where: { code: "organization.manage" }, update: {}, create: { code: "organization.manage" } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    managerId = manager.id;
    viewerId = viewer.id;
    const role = await db.roleDefinition.create({ data: { organizationId, code: "BILLING_SCREEN_MANAGER", name: "Billing screen manager", scope: "ORGANIZATION" } });
    const [managerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: managerId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } }),
    ]);
    await db.rolePermission.create({ data: { roleDefinitionId: role.id, permissionId: permission.id } });
    await db.membershipRole.create({ data: { membershipId: managerMembership.id, roleDefinitionId: role.id } });
    const visible = await db.client.create({ data: { organizationId, legalFirstName: "Visible", legalLastName: "Client", createdByUserId: managerId, status: "ACTIVE" } });
    await db.clientService.createMany({ data: [
      { organizationId, clientId: visible.id, serviceType: "SYNTHETIC_A", status: "ACTIVE", authorizationStart: new Date("2026-01-01"), authorizationEnd: new Date("2026-06-30"), authorizedHours: 20 },
      { organizationId, clientId: visible.id, serviceType: "SYNTHETIC_B", status: "ACTIVE", authorizationStart: new Date("2026-07-01"), authorizationEnd: new Date("2026-12-31"), authorizedHours: 30 },
    ] });
    await db.client.create({ data: { organizationId, legalFirstName: "Marked", legalLastName: "Test", createdByUserId: managerId, testDataMarkedAt: new Date(), testDataMarkedByUserId: managerId, testDataReason: "Synthetic exclusion" } });
    const otherUser = await db.user.create({ data: { email: `other-${tag}@example.test`, status: "ACTIVE" } });
    await db.client.create({ data: { organizationId: otherOrganizationId, legalFirstName: "Other", legalLastName: "Tenant", createdByUserId: otherUser.id } });
  });

  it("returns only current-tenant non-test clients and authoritative service context", async () => {
    const clients = await getBillingWorkspaceClients({ id: managerId }, organizationId);
    expect(clients).toEqual([{ id: expect.any(String), name: "Visible Client", status: "ACTIVE", serviceStart: "2026-01-01", serviceEnd: "2026-12-31", approvedHours: 50 }]);
    expect(clients.some(client => client.name.includes("Other Tenant"))).toBe(false);
  });

  it("rejects a member without organization management permission", async () => {
    await expect(getBillingWorkspaceClients({ id: viewerId }, organizationId)).rejects.toThrow(/organization.manage/);
  });

  it("rejects cross-tenant direct access", async () => {
    await expect(getBillingWorkspaceClients({ id: managerId }, otherOrganizationId)).rejects.toThrow(/Organization access denied/);
  });
});
