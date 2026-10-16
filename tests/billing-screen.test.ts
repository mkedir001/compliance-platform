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
  const axisCareStatus = source("src/domain/axiscare/status.ts");
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

  const panel = source("src/app/admin/billing/integration-panel.tsx");
  const match = source("src/app/admin/billing/match-review.tsx");
  const detail = source("src/app/admin/billing/client-billing-detail.tsx");
  const detailPage = source("src/app/admin/billing/[clientId]/page.tsx");

  it("lists clients as rows with name and ID left, EVV counts, ready-to-bill hours with amount, batch checkboxes and actions", () => {
    for (const text of ['role="row"', "Not EVV compliant", "EVV compliant", "Ready to bill", "Bill now", "More details", "Select all billable clients", "for group billing", "Group billing", "AxisCare ID"]) expect(portal).toContain(text);
    expect(portal).toContain("hoursWithAmount(");
    expect(portal).toContain('closest("input,button,a")');
    expect(styles).toContain(".billing-bad{color:#a43c35}");
    expect(styles).toContain(".billing-good{color:#1d6b43}");
    expect(portal).not.toContain("billing-card");
  });

  it("keeps Bill now and group billing as honest placeholders with wiring notes, and never mutates anything", () => {
    expect(portal).toContain("WIRING:");
    expect(detail).toContain("WIRING:");
    expect(portal).toContain("Billing sessions are not enabled yet");
    expect(portal).not.toContain("fetch(");
    expect(detail).not.toContain("fetch(");
    for (const forbidden of ["Preview with sample data", "Confirm billing", "hourlyRateCents"]) expect(portal + detail).not.toContain(forbidden);
  });

  it("gives each client a detail page with both billing options, non-EVV reasons, visit history and billing history", () => {
    for (const text of ["Bill everything", "Bill EVV-compliant only", "Not EVV compliant", "Visit history", "Billing history", "← All clients", "REASON_LABELS"]) expect(detail).toContain(text);
    expect(detail.indexOf("Client billing snapshot")).toBeLessThan(detail.indexOf("Billing history"));
    expect(detail.indexOf("Billing history\"")).toBeLessThan(detail.indexOf("Visit history\""));
    expect(detailPage).toContain("getBillingVisits(user,organizationId,new Date(),clientId)");
    expect(detailPage).toContain("access.canRun&&client.axisCareLinked");
    expect(detailPage).toContain("notFound()");
  });

  it("keeps the AxisCare settings compact and the connection feedback intact", () => {
    expect(panel).toContain("billing-integration-form");
    expect(panel).toContain("Caregiver mappings");
    expect(panel).toContain("Service mappings");
    expect(panel).toContain("Read-only.");
    expect(panel.match(/fetch\(/g)).toHaveLength(1);
    expect(match).toContain("/axiscare/matches/");
    expect(portal).toContain("canRun ? <MatchReview");
    expect(portal).toContain("canManageIntegration ? <IntegrationPanel");
    expect(axisCareStatus).toContain("Billing actions remain disabled.");
    expect(axisCareStatus).toContain("Read-only synchronization is available");
    for (const status of ["Saved, not verified", "Connected and verified", "Authentication failed", "Connection unavailable"]) expect(axisCareStatus).toContain(status);
  });

  it("stays responsive and accessible", () => {
    expect(portal).toContain('aria-label="Organization billing workspace"');
    expect(styles).toContain("@media(max-width:900px)");
    expect(styles).toContain("@media(max-width:700px)");
    expect(styles).toContain(".billing-directory-row{grid-template-columns:34px 1fr 1fr");
  });
});
