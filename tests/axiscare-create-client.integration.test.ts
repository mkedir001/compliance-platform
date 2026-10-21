import { beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { createClientFromAxisCare } from "@/domain/axiscare/create-client";

const db = new PrismaClient();

describe.sequential("AxisCare reviewed client creation", () => {
  let organizationId = "", otherOrganizationId = "", authorizedUserId = "", billingOnlyUserId = "";
  const tag = `axiscare-create-${Date.now()}`;
  const source = async (externalId: string, payload: Record<string, unknown>, over: { ignoredAt?: Date } = {}) => db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId, payload: payload as Prisma.InputJsonValue, payloadHash: `hash-${externalId}`, ...over } });

  beforeAll(async () => {
    const [organization, other, authorized, billingOnly] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `${tag}-authorized@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-billing@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = other.id; authorizedUserId = authorized.id; billingOnlyUserId = billingOnly.id;
    const [billing, create] = await Promise.all([
      db.permission.upsert({ where: { code: "billing.run" }, update: {}, create: { code: "billing.run" } }),
      db.permission.upsert({ where: { code: "client.create" }, update: {}, create: { code: "client.create" } }),
    ]);
    const [fullRole, billingRole] = await Promise.all([
      db.roleDefinition.create({ data: { organizationId, code: "AXISCARE_CREATE_TEST", name: "AxisCare creation test", scope: "ORGANIZATION", permissions: { create: [{ permissionId: billing.id }, { permissionId: create.id }] } } }),
      db.roleDefinition.create({ data: { organizationId, code: "AXISCARE_BILLING_ONLY_TEST", name: "AxisCare billing-only test", scope: "ORGANIZATION", permissions: { create: [{ permissionId: billing.id }] } } }),
    ]);
    await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: authorizedUserId, status: "ACTIVE", roles: { create: { roleDefinitionId: fullRole.id } } } }),
      db.organizationMembership.create({ data: { organizationId, userId: billingOnlyUserId, status: "ACTIVE", roles: { create: { roleDefinitionId: billingRole.id } } } }),
    ]);
  });

  it("creates only reviewed identity fields, intake, mapping, visits, and audits atomically", async () => {
    await source("axis-new", { id: "axis-new", firstName: "Synthetic", lastName: "Created", dateOfBirth: "1990-05-01", phone: "not-copied" });
    await db.axisCareVisit.create({ data: { organizationId, externalId: "visit-new", axisCareClientId: "axis-new", startAt: new Date("2026-10-01T12:00:00Z"), payload: {}, payloadHash: "visit-new" } });
    const clientId = await createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-new");
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { intakes: true } });
    expect(client).toMatchObject({ legalFirstName: "Synthetic", legalLastName: "Created", phone: null, status: "INTAKE_IN_PROGRESS", axisCareClientId: "axis-new" });
    expect(client.dateOfBirth?.toISOString().slice(0, 10)).toBe("1990-05-01");
    expect(client.intakes).toHaveLength(1);
    expect(await db.axisCareVisit.findUniqueOrThrow({ where: { organizationId_externalId: { organizationId, externalId: "visit-new" } } })).toMatchObject({ clientId });
    expect(await db.axisCareClientMatch.count({ where: { organizationId, axisCareClientId: "axis-new", clientId, status: "CONFIRMED" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { organizationId, entityId: clientId, eventType: { in: ["client.created_from_axiscare", "axiscare.client_created_and_mapped"] } } })).toBe(2);
  });

  it("is idempotent for retries and concurrent submissions", async () => {
    await source("axis-concurrent", { id: "axis-concurrent", firstName: "Concurrent", lastName: "Synthetic", dateOfBirth: "1991-06-02" });
    const [first, second] = await Promise.all([
      createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-concurrent"),
      createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-concurrent"),
    ]);
    expect(first).toBe(second);
    expect(await createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-concurrent")).toBe(first);
    expect(await db.client.count({ where: { organizationId, axisCareClientId: "axis-concurrent" } })).toBe(1);
  });

  it("requires both billing and client-creation permissions", async () => {
    await source("axis-denied", { id: "axis-denied", firstName: "Denied", lastName: "Synthetic" });
    await expect(createClientFromAxisCare({ id: billingOnlyUserId }, organizationId, "axis-denied")).rejects.toThrow(/client.create/);
    expect(await db.client.count({ where: { organizationId, axisCareClientId: "axis-denied" } })).toBe(0);
  });

  it("blocks ignored, cross-tenant, and possible duplicate sources", async () => {
    await source("axis-ignored", { id: "axis-ignored", firstName: "Ignored", lastName: "Synthetic" }, { ignoredAt: new Date() });
    await expect(createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-ignored")).rejects.toThrow(/not found/);
    await expect(createClientFromAxisCare({ id: authorizedUserId }, otherOrganizationId, "axis-ignored")).rejects.toThrow(/access denied/i);

    const existing = await db.client.create({ data: { organizationId, createdByUserId: authorizedUserId, legalFirstName: "Existing", legalLastName: "Synthetic", dateOfBirth: new Date("1992-07-03T00:00:00Z") } });
    await source("axis-duplicate", { id: "axis-duplicate", firstName: "Existing", lastName: "Synthetic", dateOfBirth: "1992-07-03" });
    await db.axisCareClientMatch.create({ data: { organizationId, axisCareClientId: "axis-duplicate", clientId: existing.id, status: "SUGGESTED", score: 100, reason: "Synthetic candidate" } });
    await expect(createClientFromAxisCare({ id: authorizedUserId }, organizationId, "axis-duplicate")).rejects.toThrow(/possible Waldah client/i);
    expect(await db.client.count({ where: { organizationId, axisCareClientId: "axis-duplicate" } })).toBe(0);
  });
});
