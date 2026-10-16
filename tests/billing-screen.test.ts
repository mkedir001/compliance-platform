import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("billing screen integration", () => {
  const page = source("src/app/admin/billing/page.tsx");
  const portal = source("src/app/admin/billing/billing-portal.tsx");
  const service = source("src/domain/billing/service.ts");
  const navigation = source("src/app/components/portal-ui.tsx");
  const styles = source("src/app/admin/billing/billing.css");
  const ownerBackfill = source("prisma/migrations/20261016120000_backfill_organization_owner_billing_permissions/migration.sql");

  it("reuses the existing route, shell, organization context, and one navigation item", () => {
    expect(page).toContain("resolveAdminOrganizationId");
    expect(page).toContain('<PortalShell organizationId={organizationId} current="Billing">');
    expect(navigation.match(/label: "Billing"/g)).toHaveLength(1);
    expect(navigation).toContain("/admin/billing");
  });

  it("enforces billing permissions server-side and tenant-scoped reads", () => {
    expect(service).toContain('codes.has("billing.run")');
    expect(service).toContain('codes.has("billing.view_billed")');
    expect(service).toContain('requirePermission(membership.id, "billing.run")');
    expect(service).toContain('canManageIntegration: codes.has("organization.manage")');
    expect(service).toContain("where: { organizationId, archivedAt: null, testDataMarkedAt: null }");
    expect(service.match(/where: \{ organizationId,/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain("access.canRun?await Promise.all");
  });

  it("backfills Billing access for existing organization-scoped owners", () => {
    expect(ownerBackfill).toContain('r."code" = \'ORGANIZATION_OWNER\'');
    expect(ownerBackfill).toContain('r."organizationId" IS NOT NULL');
    expect(ownerBackfill).toContain("'billing.run', 'billing.view_billed'");
    expect(ownerBackfill).toContain('ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING');
  });

  it("shows visits read-only with no billing mutation paths and no invented ledger totals", () => {
    for (const text of ["EVV compliant", "Not EVV compliant", "Billing runs are not enabled yet", "Billing actions are disabled."]) expect(portal).toContain(text);
    for (const forbidden of ["Preview with sample data", "Confirm billing", "Bill now", "hourlyRateCents"]) expect(portal).not.toContain(forbidden);
    const fetches = portal.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(2);
    expect(portal).toContain("/axiscare/matches/");
    expect(portal).toContain("/axiscare/${path}");
    expect(portal).toContain("canRun ? <MatchReview");
    expect(portal).toContain("Not connected");
  });

  it("keeps accessible responsive client cards and detail navigation", () => {
    expect(portal).toContain('aria-label="Organization billing workspace"');
    expect(portal).toContain("Open billing readiness for");
    expect(portal).toContain("← All clients");
    expect(styles).toContain("@media(max-width:700px)");
    expect(styles).toContain("grid-template-columns:repeat(auto-fill,minmax(300px,1fr))");
  });
});
