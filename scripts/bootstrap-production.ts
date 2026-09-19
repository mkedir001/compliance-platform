import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { validateProductionEnvironment } from "../src/lib/env";

const input = z.object({
  BOOTSTRAP_CONFIRM: z.literal("CREATE_FIRST_PRODUCTION_ORGANIZATION"),
  BOOTSTRAP_ORGANIZATION_NAME: z.string().trim().min(2).max(255),
  BOOTSTRAP_ORGANIZATION_SLUG: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
}).parse(process.env);
if (process.env.NODE_ENV !== "production") throw new Error("Production bootstrap requires NODE_ENV=production");
validateProductionEnvironment();
const db = new PrismaClient();
const permissionCodes = ["organization.read","organization.manage","employee.read","employee.manage","training.read","training.manage","training.catalog.read","training.catalog.manage","training.assignment.read","training.assignment.manage","training.progress.read","training.assessment.manage","training.equivalency.review","training.curriculum.publish","training.curriculum.coverage.read","competency.read","competency.assess","competency.manage","certificate.read","certificate.issue","certificate.revoke","onboarding.read","onboarding.manage","policy.read","policy.manage","policy.assign","work_readiness.read","work_readiness.evaluate","compliance.operations.read","service_assignment.read","service_assignment.manage","service_assignment.override","compliance_issue.read","compliance_issue.reconcile","compliance_issue.manage","clinical.review","medication.approve","audit.read","audit.export"];

async function main() {
  const existingCount = await db.organization.count();
  const bySlug = await db.organization.findUnique({ where: { slug: input.BOOTSTRAP_ORGANIZATION_SLUG } });
  const byEmail = await db.user.findUnique({ where: { email: input.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() } });
  if (existingCount > 0 && !bySlug) throw new Error("Bootstrap refused: an organization already exists with a different slug");
  if ((bySlug && !byEmail) || (byEmail && !bySlug)) throw new Error("Bootstrap refused: partial slug/email collision");
  if (bySlug && byEmail) {
    const membership = await db.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: bySlug.id, userId: byEmail.id } } });
    if (!membership) throw new Error("Bootstrap refused: existing organization and admin are not linked");
    console.log(JSON.stringify({ status: "already-configured", organizationId: bySlug.id, adminUserId: byEmail.id }));
    return;
  }
  const result = await db.$transaction(async tx => {
    for (const code of permissionCodes) await tx.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
    const organization = await tx.organization.create({ data: { legalName: input.BOOTSTRAP_ORGANIZATION_NAME, displayName: input.BOOTSTRAP_ORGANIZATION_NAME, slug: input.BOOTSTRAP_ORGANIZATION_SLUG } });
    const admin = await tx.user.create({ data: { email: input.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), status: "ACTIVE" } });
    const role = await tx.roleDefinition.create({ data: { organizationId: organization.id, code: "ORGANIZATION_OWNER", name: "Organization owner", scope: "ORGANIZATION" } });
    const permissions = await tx.permission.findMany({ where: { code: { in: permissionCodes } } });
    const membership = await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: admin.id, status: "ACTIVE" } });
    await tx.rolePermission.createMany({ data: permissions.map(permission => ({ roleDefinitionId: role.id, permissionId: permission.id })) });
    await tx.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: role.id } });
    await tx.auditEvent.create({ data: { organizationId: organization.id, actorUserId: admin.id, eventType: "production.bootstrap_completed", entityType: "Organization", entityId: organization.id, metadataJson: { adminUserId: admin.id } } });
    return { organizationId: organization.id, adminUserId: admin.id };
  });
  console.log(JSON.stringify({ status: "created", ...result }));
}
main().finally(() => db.$disconnect());
