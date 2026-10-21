import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getBillingAccess, getBillingVisits, getBillingWorkspaceClients } from "@/domain/billing/service";

const db = new PrismaClient();

describe.sequential("organization billing workspace", () => {
  let organizationId = "", otherOrganizationId = "", managerId = "", viewerId = "", viewBilledId = "", linkedClientId = "";

  beforeAll(async () => {
    const tag = `billing-workspace-${Date.now()}`;
    const [organization, otherOrganization, manager, viewer, viewBilled, permission, viewPermission] = await Promise.all([
      db.organization.create({ data: { legalName: `${tag} A`, displayName: `${tag} A`, slug: `${tag}-a` } }),
      db.organization.create({ data: { legalName: `${tag} B`, displayName: `${tag} B`, slug: `${tag}-b` } }),
      db.user.create({ data: { email: `manager-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `viewer-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `viewbilled-${tag}@example.test`, status: "ACTIVE" } }),
      db.permission.upsert({ where: { code: "billing.run" }, update: {}, create: { code: "billing.run" } }),
      db.permission.upsert({ where: { code: "billing.view_billed" }, update: {}, create: { code: "billing.view_billed" } }),
    ]);
    viewBilledId = viewBilled.id;
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    managerId = manager.id;
    viewerId = viewer.id;
    const role = await db.roleDefinition.create({ data: { organizationId, code: "BILLING_SCREEN_MANAGER", name: "Billing screen manager", scope: "ORGANIZATION" } });
    const [managerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: managerId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } }),
    ]);
    const viewRole = await db.roleDefinition.create({ data: { organizationId, code: "BILLING_VIEW_ONLY", name: "Billing view only", scope: "ORGANIZATION" } });
    const viewMembership = await db.organizationMembership.create({ data: { organizationId, userId: viewBilledId, status: "ACTIVE" } });
    await db.rolePermission.create({ data: { roleDefinitionId: viewRole.id, permissionId: viewPermission.id } });
    await db.membershipRole.create({ data: { membershipId: viewMembership.id, roleDefinitionId: viewRole.id } });
    await db.rolePermission.create({ data: { roleDefinitionId: role.id, permissionId: permission.id } });
    await db.rolePermission.create({ data: { roleDefinitionId: role.id, permissionId: viewPermission.id } });
    await db.membershipRole.create({ data: { membershipId: managerMembership.id, roleDefinitionId: role.id } });
    const visible = await db.client.create({ data: { organizationId, legalFirstName: "Visible", legalLastName: "Client", createdByUserId: managerId, status: "ACTIVE" } });
    linkedClientId = visible.id;
    await db.client.update({ where: { id: visible.id }, data: { axisCareClientId: "ax-1" } });
    const visit = (externalId: string, over: object = {}) => ({ organizationId, externalId, axisCareClientId: "ax-1", clientId: visible.id, startAt: new Date(), clockInAt: new Date(Date.now() - 7_200_000), clockOutAt: new Date(), clockInLatitude: "43.000000", clockInLongitude: "-93.000000", clockOutLatitude: "43.000000", clockOutLongitude: "-93.000000", serviceCode: "HOMEMAKING", chargeRateCents: 2500, payload: {}, payloadHash: "h", ...over });
    await db.axisCareVisit.createMany({ data: [visit("v-ok"), visit("v-noout", { clockOutAt: null }), visit("v-removed", { removed: true }), visit("v-other-org", { organizationId: otherOrganizationId, clientId: null })] });
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
    expect(clients).toEqual([{ id: expect.any(String), name: "Visible Client", status: "ACTIVE", serviceStart: "2026-01-01", serviceEnd: "2026-12-31", approvedHours: 50, axisCareLinked: true, axisCareClientId: "ax-1" }]);
    expect(clients.some(client => client.name.includes("Other Tenant"))).toBe(false);
  });

  it("rejects a member without organization management permission", async () => {
    await expect(getBillingWorkspaceClients({ id: viewerId }, organizationId)).rejects.toThrow(/billing.view/);
  });

  it("lets billing.view_billed see clients but not visits or run billing", async () => {
    expect(await getBillingAccess({ id: viewBilledId }, organizationId)).toMatchObject({ canView: true, canInitiate: false, canRun: false, canManageMapping: false, canManageSync: false, canManageIntegration: false });
    const viewOnly = await getBillingWorkspaceClients({ id: viewBilledId }, organizationId);
    expect(viewOnly).toHaveLength(1);
    expect(viewOnly[0].axisCareClientId).toBeNull();
    expect((await getBillingVisits({ id: viewBilledId }, organizationId)).length).toBeGreaterThan(0);
  });

  it("returns EVV-classified visits for billing.run, current tenant, excluding removed visits", async () => {
    expect((await getBillingAccess({ id: managerId }, organizationId)).canRun).toBe(true);
    const visits = await getBillingVisits({ id: managerId }, organizationId);
    expect(visits.map(v => [v.compliant, v.hours, v.amountCents]).sort()).toEqual([[false, null, null], [true, 2, 5000]]);
    expect(visits.every(v => v.clientId === linkedClientId)).toBe(true);
    expect(await getBillingVisits({ id: managerId }, organizationId, new Date(), linkedClientId)).toHaveLength(visits.length);
    expect(await getBillingVisits({ id: managerId }, organizationId, new Date(), "no-such-client")).toEqual([]);
  });

  it("rejects cross-tenant direct access", async () => {
    await expect(getBillingWorkspaceClients({ id: managerId }, otherOrganizationId)).rejects.toThrow(/Organization access denied/);
  });
});
