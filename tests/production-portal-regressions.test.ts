import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(path, "utf8");

describe("production portal regression remediation", () => {
  it("uses membership-derived training catalog context and human-readable employee selection", async () => {
    const [page, catalog] = await Promise.all([source("src/app/admin/training/page.tsx"), source("src/app/admin/training/training-catalog.tsx")]);
    expect(page).toContain("resolveAdminOrganizationId");
    expect(catalog).not.toMatch(/Admin user ID|Organization ID|Employee ID|x-dev-user-id/);
    expect(catalog).toContain("Catalog and authorized employee roster loaded");
    expect(catalog).toContain("employee.firstName");
    expect(catalog).toContain("employee.lastName");
    expect(catalog).toContain("Loading the catalog is read-only");
    expect(catalog).not.toMatch(/history\.(pushState|replaceState)|router\.(push|replace)/);
  });

  it("preserves authorized organization context across natural portal entries", async () => {
    const files = await Promise.all([
      "home/page.tsx",
      "employees/page.tsx",
      "employees/[employeeId]/page.tsx",
      "clients/page.tsx",
      "clients/[clientId]/page.tsx",
      "evidence-operations/page.tsx",
      "competencies/page.tsx",
      "audit-access/page.tsx",
      "policy-operations/page.tsx",
      "training/page.tsx",
      "reporting/page.tsx",
      "setup/page.tsx",
    ].map(path => source(`src/app/admin/${path}`)));
    for (const file of files) expect(file).toContain("resolveAdminOrganizationId");
    const helper = await source("src/app/admin/organization-context.ts");
    expect(helper).toContain("resolveAuthorizedAdminDestination");
    expect(helper).toContain('redirect("/")');
  });

  it("keeps Clients inside the complete shared organization shell", async () => {
    const clients = await source("src/app/admin/clients/clients-portal.tsx");
    expect(clients).toContain('<PortalShell organizationId={organizationId} current="Clients">');
    expect(clients).not.toContain("navigation={portalNavigation}");
  });

  it("hosts the authoritative split-pane owner-assistance player in Employee Record Training", async () => {
    const [operations, workspace] = await Promise.all([source("src/app/admin/operations-portal.tsx"), source("src/app/admin/training-operations-workspace.tsx")]);
    expect(operations).toContain("loadEmployeeTraining");
    expect(operations).toContain("employeeTrainingWorkspace");
    expect(operations).toContain("trainingWorkspace={employeeTrainingWorkspace}");
    expect(operations).toContain("{trainingWorkspace}");
    expect(workspace).toContain("training-split-pane");
    expect(workspace).toContain("Assigned courses");
    expect(workspace).toContain("fixedEmployee");
  });
});
