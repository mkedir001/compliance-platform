import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { GET } from "@/app/api/organizations/[organizationId]/training/catalog/route";

const db = new PrismaClient();

describe.sequential("training catalog read boundary", () => {
  let organizationId = "", ownerId = "";

  beforeAll(async () => {
    const tag = `catalog-read-${Date.now()}`;
    const [owner, ownerRole] = await Promise.all([
      db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } }),
    ]);
    ownerId = owner.id;
    const organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } });
    organizationId = organization.id;
    await db.organizationMembership.create({ data: { organizationId, userId: ownerId, status: "ACTIVE", roles: { create: { roleDefinitionId: ownerRole.id } } } });
  });

  it("loads the authorized catalog without changing organization, workforce, assignment, or audit state", async () => {
    const snapshot = async () => Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { updatedAt: true } }),
      db.organizationMembership.count({ where: { organizationId } }),
      db.employee.count({ where: { organizationId } }),
      db.trainingAssignment.count({ where: { organizationId } }),
      db.auditEvent.count({ where: { organizationId } }),
    ]);
    const before = await snapshot();
    const response = await GET(new Request(`http://localhost/api/organizations/${organizationId}/training/catalog`, { headers: { "x-dev-user-id": ownerId } }), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});
