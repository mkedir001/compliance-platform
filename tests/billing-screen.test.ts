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

  it("reuses the existing route, shell, organization context, and one navigation item", () => {
    expect(page).toContain("resolveAdminOrganizationId");
    expect(page).toContain('<PortalShell organizationId={organizationId} current="Billing">');
    expect(navigation.match(/label: "Billing"/g)).toHaveLength(1);
    expect(navigation).toContain("/admin/billing");
  });

  it("enforces server-side management permission and tenant-scoped client reads", () => {
    expect(service).toContain('requirePermission(membership.id, "organization.manage")');
    expect(service).toContain("where: { organizationId, archivedAt: null, testDataMarkedAt: null }");
    expect(service).not.toContain("findMany({\n    where: {}");
  });

  it("renders a safe read-only screen without fabricated money or mutation paths", () => {
    for (const text of ["Billing and visit data are not connected.", "Billing actions unavailable", "No financial totals are displayed", "Billing actions are disabled."]) expect(portal).toContain(text);
    for (const forbidden of ["Preview with sample data", "Confirm billing", "Bill now", "fetch(", "method: \"POST\"", "formatMoney", "hourlyRateCents"]) expect(portal).not.toContain(forbidden);
  });

  it("keeps accessible responsive client cards and detail navigation", () => {
    expect(portal).toContain('aria-label="Organization billing workspace"');
    expect(portal).toContain("Open billing readiness for");
    expect(portal).toContain("← All clients");
    expect(styles).toContain("@media(max-width:700px)");
    expect(styles).toContain("grid-template-columns:repeat(auto-fill,minmax(300px,1fr))");
  });
});
