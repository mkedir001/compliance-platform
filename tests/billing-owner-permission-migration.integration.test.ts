import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBillingAccess, getBillingWorkspaceClients } from "@/domain/billing/service";

const db = new PrismaClient();
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20261016120000_backfill_organization_owner_billing_permissions/migration.sql"),
  "utf8",
);

describe.sequential("organization-owner Billing permission backfill", () => {
  const tag = `billing-owner-backfill-${Date.now()}`;
  let organizationId = "";
  let ownerUserId = "";
  let ownerRoleId = "";

  beforeAll(async () => {
    const [organization, owner, managePermission] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }),
      db.permission.findUniqueOrThrow({ where: { code: "organization.manage" } }),
    ]);
    organizationId = organization.id;
    ownerUserId = owner.id;
    const ownerRole = await db.roleDefinition.create({
      data: {
        organizationId,
        code: "ORGANIZATION_OWNER",
        name: "Organization owner",
        scope: "ORGANIZATION",
        isPlatformStandard: false,
        permissions: { create: { permissionId: managePermission.id } },
      },
    });
    ownerRoleId = ownerRole.id;
    const membership = await db.organizationMembership.create({
      data: { organizationId, userId: ownerUserId, status: "ACTIVE" },
    });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: ownerRoleId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("reproduces the production denial before the backfill", async () => {
    await expect(getBillingAccess({ id: ownerUserId }, organizationId)).rejects.toThrow(/billing\.view/);
  });

  it("grants both Billing permissions to an existing organization-scoped owner idempotently", async () => {
    await db.$executeRawUnsafe(migration);
    await db.$executeRawUnsafe(migration);

    await expect(getBillingAccess({ id: ownerUserId }, organizationId)).resolves.toMatchObject({ canView: true, canInitiate: true, canRun: true, canManageIntegration: true });
    await expect(getBillingWorkspaceClients({ id: ownerUserId }, organizationId)).resolves.toEqual([]);
    const permissions = await db.rolePermission.findMany({
      where: { roleDefinitionId: ownerRoleId, permission: { code: { in: ["billing.run", "billing.view_billed"] } } },
      select: { permission: { select: { code: true } } },
    });
    expect(permissions.map(row => row.permission.code).sort()).toEqual(["billing.run", "billing.view_billed"]);
  });
});
