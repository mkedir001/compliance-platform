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
  const matchRoute = source("src/app/api/organizations/[organizationId]/axiscare/matches/route.ts");
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

  it("keeps every unsupported billing action visibly present but disabled, with wiring notes and no mutation path", () => {
    expect(portal).toContain("WIRING:");
    expect(detail).toContain("WIRING:");
    expect(portal + detail).toContain("Billing submission is not enabled yet");
    expect(portal).toContain('<button type="button" disabled title="Billing sessions are not enabled yet">Group billing</button>');
    expect(portal).toContain('disabled title="Billing sessions are not enabled yet" aria-label={`Bill now for ${client.name}`}');
    expect(detail).toContain('<button type="button" disabled title="Billing sessions are not enabled yet">Bill everything');
    expect(detail).toContain('<button type="button" disabled title="Billing sessions are not enabled yet">Bill selected</button>');
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

  it("collapses non-compliant details by default and exposes explicit EVV evaluation states", () => {
    expect(detail).toContain('<details className="billing-noncompliant"');
    expect(detail).toContain("<summary><h2>Not EVV compliant");
    expect(detail).toContain("Not yet evaluated");
    expect(detail).toContain("Requires review");
    expect(styles).toContain(".billing-noncompliant[open]");
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

  it("supports lifecycle-aware matching review, persistent ignore, and bounded bulk actions", () => {
    for (const text of ["AxisCare status", "Matching status", "Needs review", "Discharged", "Archived", "Unknown", "Confirmed", "Ignored", "Ignore selected", "Select visible clients", "Restore", "PAGE_SIZE = 25"]) expect(match).toContain(text);
    expect(match).toContain("window.confirm");
    expect(match).toContain("visible.filter");
    expect(match).toContain('action: "IGNORE"');
    expect(match).toContain('setDisposition(row, "RESTORE")');
    expect(page).toContain("getAxisCareClientMatches");
    expect(service).toContain("mapClientLifecycle");
    expect(service).toContain('state = record.ignoredAt ? "IGNORED"');
    expect(matchRoute).toContain("requireOrganizationAccess(user, organizationId)");
    expect(matchRoute).toContain('requirePermission(membership.id, "billing.run")');
    expect(matchRoute).toContain('requirePermission(membership.id, "client.create")');
    expect(matchRoute).toContain("changeAxisCareClientDisposition");
    expect(match).toContain("Create client");
    expect(match).toContain('row.state === "UNMATCHED"');
  });

  it("stays responsive and accessible", () => {
    expect(portal).toContain('aria-label="Organization billing workspace"');
    expect(styles).toContain("@media(max-width:900px)");
    expect(styles).toContain("@media(max-width:700px)");
    expect(styles).toContain(".billing-directory-row{grid-template-columns:34px 1fr 1fr");
  });

  it("lets visits be selected for partial billing and shows the caregiver instead of clock times", () => {
    for (const text of ["Bill selected", "} selected", "Select all shown visits", "<th>Caregiver</th>", "visit.caregiverName"]) expect(detail).toContain(text);
    expect(detail).not.toContain("Clock in / out");
    expect(service).toContain("caregiverName");
  });

  it("keeps a visible disclosure chevron on the slim AxisCare settings", () => {
    expect(styles).toContain(".billing-integration-admin>summary::before");
    expect(styles).toContain(".billing-integration-admin[open]>summary::before");
  });

  it("shows per-visit billing results with a drawer, result filters, and list badges", () => {
    const drawer = source("src/app/admin/billing/billing-result-drawer.tsx");
    for (const text of ["Billing result", "View error", "View receipt", "Billed", "Not billed", "EVV compliant", "billedFilter", "BillingResultDrawer"]) expect(detail).toContain(text);
    for (const text of ['role="dialog"', 'aria-modal="true"', "Escape", "Retry this visit", "Copy details", "Amount that went through"]) expect(drawer).toContain(text);
    expect(styles).toContain("@media (max-width:720px)");
    expect(styles).toContain(".billing-drawer");
    expect(portal).toContain("had errors");
    expect(portal).toContain("billing {errors");
    expect(detail + drawer).toContain("WIRING:");
    expect(drawer).toContain('<button type="button" disabled title="Billing retries are not enabled yet">Retry this visit</button>');
  });
});
