import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("employee profile, test-data management, and care answer UI", () => {
  it("keeps workforce controls on the directory and returns the individual record before rendering them", () => {
    const portal = source("src/app/admin/operations-portal.tsx");
    for (const expected of ["Search by name or employee number", "Employment", "Needs attention", "Reissue all", "Import from CSV", "Add employee"]) expect(portal).toContain(expected);
    const detailReturn = portal.indexOf('if(tab==="employees"&&detail)return');
    const directoryReturn = portal.indexOf('return <PortalShell organizationId={organizationId} current={tab===', detailReturn);
    expect(detailReturn).toBeGreaterThan(0);
    expect(directoryReturn).toBeGreaterThan(detailReturn);
    const detailBranch = portal.slice(detailReturn, directoryReturn);
    expect(detailBranch).toContain("<EmployeeDetail");
    expect(detailBranch).not.toMatch(/Search by name|employee-toolbar|directory-alert|reissueAll/);
    expect(portal).toContain('detail.portalAccess?.status==="PENDING"?"Reissue invitation":"Create invitation"');
    for (const tab of ["Overview", "Training", "Certifications", "Policies", "Medication", "Client assignments", "Access and roles", "History"]) expect(portal).toContain(tab);
  });

  it("makes Test Data Management discoverable and enforces organization.manage before rendering", () => {
    const setup = source("src/app/admin/setup/setup-portal.tsx");
    const setupPage = source("src/app/admin/setup/page.tsx");
    const cleanupPage = source("src/app/admin/setup/test-data-cleanup/page.tsx");
    const cleanup = source("src/app/admin/setup/test-data-cleanup/test-data-cleanup-portal.tsx");
    expect(setup).toContain("Test Data Management");
    expect(setup).toContain("/admin/setup/test-data-cleanup?organizationId=");
    expect(setupPage).toContain("productionIdentity");
    expect(cleanupPage).toContain("resolveAdminOrganizationIdWithPermission");
    expect(cleanupPage).toContain('"organization.manage"');
    for (const safeguard of ["Dependency-aware preview", "CLEAN SELECTED TEST DATA", "Any record", "dependency change invalidates this preview", "Legacy record — not marked as test data"]) expect(cleanup).toContain(safeguard);
  });

  it("keeps care answers native, persistent, validated, wrapping, and mobile usable", () => {
    const workflow = source("src/app/admin/clients/client-import-workflow.tsx");
    const styles = source("src/app/globals.css");
    for (const expected of ['type="radio"', 'role="radiogroup"', "aria-invalid={!ready}", "Choose Yes, No, or Not applicable before saving.", "sessionStorage", "selectedAnswer", "Save answer", "Reject"]) expect(workflow).toContain(expected);
    expect(styles).toContain("overflow-wrap:anywhere");
    expect(styles).toContain("@media(max-width:480px)");
    expect(styles).toContain("flex-direction:column-reverse");
  });
});
