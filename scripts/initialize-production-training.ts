import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { seedProductionCurriculum } from "../prisma/seed-curriculum";
import { seedProductionRegulatoryRegistry } from "../prisma/seed-regulatory";
import { validateProductionEnvironment } from "../src/lib/env";

const inputSchema = z.object({
  confirmation: z.literal("INITIALIZE_MN_245D_TRAINING"),
  organizationSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).strict();

export async function initializeProductionTraining(db: PrismaClient, raw: unknown) {
  const input = inputSchema.parse(raw);
  const organization = await db.organization.findUnique({ where: { slug: input.organizationSlug }, select: { id: true, slug: true } });
  if (!organization) throw new Error("Configured production organization was not found");
  const conflictingLicense = await db.organizationLicense.findFirst({ where: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: { not: "ACTIVE" } } });
  if (conflictingLicense) throw new Error("Existing Minnesota 245D configuration requires administrator review before activation");

  return db.$transaction(async tx => {
    const ruleset = await seedProductionRegulatoryRegistry(tx);
    await seedProductionCurriculum(tx);
    let license = await tx.organizationLicense.findFirst({ where: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: "ACTIVE" } });
    if (!license) {
      license = await tx.organizationLicense.create({ data: { organizationId: organization.id, licenseType: "MN_245D", licenseStatus: "ACTIVE", effectiveDate: new Date("2026-08-01T00:00:00.000Z"), issuingAuthority: "Minnesota Department of Human Services" } });
      await tx.auditEvent.create({ data: { organizationId: organization.id, eventType: "organization.program_configured", entityType: "OrganizationLicense", entityId: license.id, metadataJson: { licenseType: "MN_245D", status: "ACTIVE", source: "controlled-production-training-initialization" } } });
    }
    const [requirements, courses, activeVersions, mappings] = await Promise.all([
      tx.complianceRulesetRequirement.count({ where: { rulesetId: ruleset.id } }),
      tx.trainingCourse.count({ where: { organizationId: null, ownershipType: "PLATFORM", status: "ACTIVE", code: { startsWith: "245D-" } } }),
      tx.trainingCourseVersion.count({ where: { status: "ACTIVE", course: { organizationId: null, ownershipType: "PLATFORM", code: { startsWith: "245D-" } } } }),
      tx.requirementTrainingOption.count({ where: { trainingCourseVersion: { course: { organizationId: null, ownershipType: "PLATFORM", code: { startsWith: "245D-" } } } } }),
    ]);
    return { organization: organization.slug, license: license.licenseType, rulesetVersion: ruleset.version, requirements, courses, activeVersions, mappings };
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function main() {
  if (process.env.NODE_ENV !== "production") throw new Error("Production training initialization requires NODE_ENV=production");
  validateProductionEnvironment();
  const db = new PrismaClient();
  try {
    const result = await initializeProductionTraining(db, { confirmation: process.env.TRAINING_REFERENCE_CONFIRM, organizationSlug: process.env.TRAINING_ORGANIZATION_SLUG });
    console.log(JSON.stringify({ status: "configured", ...result }));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
