import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(path, "utf8");

describe("visual-QA portal remediation", () => {
  it("uses reference-board contrast for every authoritative Home metric", async () => {
    const [operations, styles] = await Promise.all([source("src/app/admin/operations-portal.tsx"), source("src/app/globals.css")]);
    expect(operations).toContain('className="metric-grid organization-metrics"');
    expect((operations.match(/<Metric value=/g) ?? [])).toHaveLength(8);
    expect(styles).toContain(".portal-app .organization-metrics>button");
    expect(styles).toContain("background:var(--portal-white);color:var(--portal-ink)");
    expect(styles).toContain(".portal-app .organization-metrics>button span{color:var(--portal-muted)");
  });

  it("renders one URL-addressable employee record tab panel instead of scroll anchors", async () => {
    const operations = await source("src/app/admin/operations-portal.tsx");
    expect(operations).toContain('useState<EmployeeRecordTab>("overview")');
    expect(operations).toContain('role="tablist"');
    expect(operations).toContain('role="tabpanel"');
    expect(operations).toContain('aria-selected={selectedTab===item}');
    for (const tab of ["overview", "training", "certifications", "policies", "medication", "client-assignments", "access-roles", "history"]) {
      expect(operations).toContain(`selectedTab==="${tab}"`);
    }
    expect(operations).not.toContain("scrollIntoView");
    expect(operations).not.toContain("employee-section-");
  });

  it("keeps the employee identity primary and preserves authoritative workflow components", async () => {
    const operations = await source("src/app/admin/operations-portal.tsx");
    expect(operations).toContain('tab==="employees"&&detail?null:<header>');
    expect(operations).toContain("<h1>{e.firstName} {e.lastName}</h1>");
    expect(operations).toContain("<EmployeeTrainingReadiness");
    expect(operations).toContain("<WorkforceControls");
    expect(operations).toContain("async function invite(id:string){if(busy)return;");
  });

  it("separates client records and record sections without dark-on-dark cards", async () => {
    const [clients, styles] = await Promise.all([source("src/app/admin/clients/clients-portal.tsx"), source("src/app/globals.css")]);
    expect(clients).toContain('className="workforce-table client-directory"');
    expect(clients).toContain('className="client-record"');
    expect(styles).toContain(".client-directory{display:grid;gap:12px");
    expect(styles).toContain(".portal-app .client-directory-row{margin:0;padding:16px;border:1px solid var(--portal-border);border-radius:12px;background:#fff;color:var(--portal-ink)");
    expect(styles).toContain(".client-record{display:grid;gap:20px}");
  });
});
