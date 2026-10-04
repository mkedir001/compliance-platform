import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { initializeProductionTraining } from "../scripts/initialize-production-training";

const db = new PrismaClient();

describe.sequential("controlled production training reference initialization", () => {
  it("idempotently initializes the existing 245D registry, curriculum, mappings, and selected organization license", async () => {
    const tag = `production-training-${Date.now()}`;
    const organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } });
    const input = { confirmation: "INITIALIZE_MN_245D_TRAINING", organizationSlug: organization.slug } as const;
    const first = await initializeProductionTraining(db, input);
    const second = await initializeProductionTraining(db, input);

    expect(first).toMatchObject({ organization: organization.slug, license: "MN_245D", rulesetVersion: 1, courses: 12, activeVersions: 12 });
    expect(second).toEqual(first);
    expect(first.requirements).toBeGreaterThan(0);
    expect(first.mappings).toBeGreaterThan(0);
    expect(await db.organizationLicense.count({ where: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: "ACTIVE" } })).toBe(1);
    expect(await db.trainingAssignment.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await db.employeeWorkforceReadiness.count({ where: { organizationId: organization.id } })).toBe(0);
  }, 120_000);

  it("refuses to override a pending organization decision", async () => {
    const tag = `production-training-pending-${Date.now()}`;
    const organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } });
    await db.organizationLicense.create({ data: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: "PENDING" } });
    await expect(initializeProductionTraining(db, { confirmation: "INITIALIZE_MN_245D_TRAINING", organizationSlug: organization.slug })).rejects.toThrow("requires administrator review");
    expect(await db.organizationLicense.count({ where: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: "PENDING" } })).toBe(1);
  });
});
