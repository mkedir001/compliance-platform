import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCleanupPreview,
  executeCleanupPreview,
  getCleanupAuditHistory,
  markTestData,
  searchCleanupCandidates,
} from "@/domain/test-data-cleanup/service";

const db = new PrismaClient();

describe.sequential("audited organization test-data cleanup", () => {
  let organizationId: string,
    otherOrganizationId: string,
    ownerId: string,
    viewerId: string,
    foreignClientId: string;
  const owner = () => ({ id: ownerId });
  beforeAll(async () => {
    const tag = `cleanup-${Date.now()}`,
      [organization, other, ownerUser, viewer] = await Promise.all([
        db.organization.create({
          data: { legalName: tag, displayName: tag, slug: tag },
        }),
        db.organization.create({
          data: {
            legalName: `${tag}-other`,
            displayName: `${tag}-other`,
            slug: `${tag}-other`,
          },
        }),
        db.user.create({
          data: { email: `${tag}-owner@example.test`, status: "ACTIVE" },
        }),
        db.user.create({
          data: { email: `${tag}-viewer@example.test`, status: "ACTIVE" },
        }),
      ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    ownerId = ownerUser.id;
    viewerId = viewer.id;
    const permission = await db.permission.findUniqueOrThrow({
        where: { code: "organization.manage" },
      }),
      role = await db.roleDefinition.create({
        data: {
          organizationId,
          code: "CLEANUP_OWNER",
          name: "Cleanup owner",
          scope: "ORGANIZATION",
          permissions: { create: { permissionId: permission.id } },
        },
      }),
      membership = await db.organizationMembership.create({
        data: { organizationId, userId: ownerId, status: "ACTIVE" },
      });
    await Promise.all([
      db.membershipRole.create({
        data: { membershipId: membership.id, roleDefinitionId: role.id },
      }),
      db.organizationMembership.create({
        data: { organizationId, userId: viewerId, status: "ACTIVE" },
      }),
    ]);
    foreignClientId = (
      await db.client.create({
        data: {
          organizationId: otherOrganizationId,
          createdByUserId: ownerId,
          legalFirstName: "Foreign",
          legalLastName: "Synthetic",
        },
      })
    ).id;
  });

  it("keeps candidate search tenant-scoped and owner-only", async () => {
    await db.client.create({
      data: {
        organizationId,
        createdByUserId: ownerId,
        legalFirstName: "Selected",
        legalLastName: "Synthetic",
      },
    });
    const rows = await searchCleanupCandidates(owner(), organizationId, {
      type: "CLIENT",
      search: "Synthetic",
    });
    expect(rows.some((row) => row.id === foreignClientId)).toBe(false);
    await expect(
      searchCleanupCandidates({ id: viewerId }, organizationId, {
        type: "CLIENT",
      }),
    ).rejects.toThrow(/organization.manage/);
    const foreign = await db.client.findUniqueOrThrow({
      where: { id: foreignClientId },
    });
    await expect(
      createCleanupPreview(owner(), organizationId, [
        {
          type: "CLIENT",
          id: foreign.id,
          version: foreign.updatedAt.toISOString(),
        },
      ]),
    ).rejects.toThrow(/not found/);
  });

  it("classifies dependencies, blocks authentication-linked staff, safely archives evidence, and deletes only marked dependency-free records", async () => {
    const safeClient = await db.client.create({
        data: {
          organizationId,
          createdByUserId: ownerId,
          legalFirstName: "Delete",
          legalLastName: "Synthetic",
          status: "PROSPECTIVE",
        },
      }),
      retainedClient = await db.client.create({
        data: {
          organizationId,
          createdByUserId: ownerId,
          legalFirstName: "Retain",
          legalLastName: "Synthetic",
          status: "PROSPECTIVE",
        },
      }),
      safeEmployee = await db.employee.create({
        data: {
          organizationId,
          firstName: "Delete",
          lastName: "Worker",
          employmentStatus: "PENDING",
        },
      }),
      linkedUser = await db.user.create({
        data: {
          email: `cleanup-linked-${Date.now()}@example.test`,
          status: "ACTIVE",
        },
      }),
      blockedEmployee = await db.employee.create({
        data: {
          organizationId,
          userId: linkedUser.id,
          firstName: "Blocked",
          lastName: "Worker",
          employmentStatus: "PENDING",
        },
      });
    await db.referral.create({
      data: {
        organizationId,
        createdByUserId: ownerId,
        recipientName: "Synthetic retained referral",
        formStatus: "SUBMITTED",
        linkedClientId: retainedClient.id,
      },
    });
    for (const [type, row] of [
      ["CLIENT", safeClient],
      ["EMPLOYEE", safeEmployee],
    ] as const)
      await markTestData(owner(), organizationId, {
        action: "MARK",
        type,
        id: row.id,
        version: row.updatedAt.toISOString(),
        reason: "Verified synthetic integration test record",
        confirmation: "MARK AS TEST DATA",
      });
    const refreshedClient = await db.client.findUniqueOrThrow({
        where: { id: safeClient.id },
      }),
      refreshedEmployee = await db.employee.findUniqueOrThrow({
        where: { id: safeEmployee.id },
      }),
      preview = await createCleanupPreview(owner(), organizationId, [
        {
          type: "CLIENT",
          id: refreshedClient.id,
          version: refreshedClient.updatedAt.toISOString(),
        },
        {
          type: "CLIENT",
          id: retainedClient.id,
          version: retainedClient.updatedAt.toISOString(),
        },
        {
          type: "EMPLOYEE",
          id: refreshedEmployee.id,
          version: refreshedEmployee.updatedAt.toISOString(),
        },
        {
          type: "EMPLOYEE",
          id: blockedEmployee.id,
          version: blockedEmployee.updatedAt.toISOString(),
        },
      ]);
    expect(preview.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: safeClient.id,
          classification: "DELETE_SAFE",
        }),
        expect.objectContaining({
          id: retainedClient.id,
          classification: "ARCHIVE_REQUIRED",
          dependencies: expect.objectContaining({ referrals: 1 }),
        }),
        expect.objectContaining({
          id: safeEmployee.id,
          classification: "DELETE_SAFE",
        }),
        expect.objectContaining({
          id: blockedEmployee.id,
          classification: "BLOCKED",
          dependencies: expect.objectContaining({ authenticationLinks: 1 }),
        }),
      ]),
    );
    const idempotencyKey = randomUUID(),
      result = await executeCleanupPreview(
        owner(),
        organizationId,
        preview.previewId,
        { confirmation: "CLEAN SELECTED TEST DATA", idempotencyKey },
      ),
      retry = await executeCleanupPreview(
        owner(),
        organizationId,
        preview.previewId,
        { confirmation: "CLEAN SELECTED TEST DATA", idempotencyKey },
      );
    expect(retry).toEqual(result);
    expect(
      await db.client.findUnique({ where: { id: safeClient.id } }),
    ).toBeNull();
    expect(
      (await db.client.findUniqueOrThrow({ where: { id: retainedClient.id } }))
        .status,
    ).toBe("ARCHIVED");
    expect(
      await db.employee.findUnique({ where: { id: safeEmployee.id } }),
    ).toBeNull();
    expect(
      await db.employee.findUnique({ where: { id: blockedEmployee.id } }),
    ).not.toBeNull();
    expect(
      (await getCleanupAuditHistory(owner(), organizationId)).filter(
        (row) => row.eventType === "test_data.cleanup_executed",
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects stale previews after a concurrent record change", async () => {
    const client = await db.client.create({
      data: {
        organizationId,
        createdByUserId: ownerId,
        legalFirstName: "Stale",
        legalLastName: "Synthetic",
        status: "PROSPECTIVE",
      },
    });
    await markTestData(owner(), organizationId, {
      type: "CLIENT",
      id: client.id,
      version: client.updatedAt.toISOString(),
      reason: "Verified synthetic stale-preview test",
      confirmation: "MARK AS TEST DATA",
    });
    const marked = await db.client.findUniqueOrThrow({
        where: { id: client.id },
      }),
      preview = await createCleanupPreview(owner(), organizationId, [
        {
          type: "CLIENT",
          id: client.id,
          version: marked.updatedAt.toISOString(),
        },
      ]);
    await db.client.update({
      where: { id: client.id },
      data: { preferredName: "Changed concurrently" },
    });
    await expect(
      executeCleanupPreview(owner(), organizationId, preview.previewId, {
        confirmation: "CLEAN SELECTED TEST DATA",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "STALE_PREVIEW" });
    expect(
      await db.client.findUnique({ where: { id: client.id } }),
    ).not.toBeNull();
    expect(
      (
        await db.testDataCleanupPreview.findUniqueOrThrow({
          where: { id: preview.previewId },
        })
      ).status,
    ).toBe("STALE");
  });
});
