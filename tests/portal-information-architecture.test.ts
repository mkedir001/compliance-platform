import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(path, "utf8");

describe("portal information architecture", () => {
  it("provides the organization navigation and person-centered record sections", async () => {
    const [shell, operations, clients] = await Promise.all([
      source("src/app/components/portal-ui.tsx"),
      source("src/app/admin/operations-portal.tsx"),
      source("src/app/admin/clients/clients-portal.tsx"),
    ]);
    for (const label of ["Home", "Employees", "Clients", "Evidence review", "Competency assessments", "Signatures", "Policies", "Training catalog", "Reports and audit", "Settings"]) expect(shell).toContain(label);
    for (const label of ["Overview", "Training", "Certifications and evidence", "Policies", "Medication", "Client assignments", "Access and roles", "History"]) expect(operations).toContain(label);
    expect(operations).toContain('/action-center?page=1&pageSize=8');
    expect(operations).toContain("homeActions.map");
    for (const label of ["Overview", "Intake", "Services", "Documents", "Signatures", "Readiness", "Contacts", "History"]) expect(clients).toContain(label);
  });

  it("keeps natural entry points and legacy operations compatibility", async () => {
    const [home, employees, employee, legacy] = await Promise.all([
      source("src/app/admin/home/page.tsx"),
      source("src/app/admin/employees/page.tsx"),
      source("src/app/admin/employees/[employeeId]/page.tsx"),
      source("src/app/admin/compliance-operations/page.tsx"),
    ]);
    expect(home).toContain("/admin/compliance-operations");
    expect(employees).toContain("view=employees");
    expect(employee).toContain("employeeId");
    expect(legacy).toContain("EmployerOperationsPortal");
  });

  it("uses a reusable asynchronous state machine and accessible feedback without timers", async () => {
    const [ui, controls] = await Promise.all([source("src/app/components/portal-ui.tsx"), source("src/app/admin/workforce-controls.tsx")]);
    expect(ui).toContain('"idle" | "pending" | "success" | "error"');
    expect(ui).toContain('state === "pending"');
    expect(ui).toContain('aria-live="polite"');
    expect(ui).toContain('role="dialog"');
    expect(ui).not.toContain("setTimeout");
    expect(controls).toContain('aria-busy={pending}');
    expect(controls).toContain("Updating status…");
    expect(controls).toContain("await onChanged()");
    const operations = await source("src/app/admin/operations-portal.tsx");
    expect(operations).toContain("async function invite(id:string){if(busy)return;");
    expect(operations).toContain('[busyMessage,setBusyMessage]=useState("Working…")');
    expect(operations).toContain('{busy?busyMessage:message}');
    expect(operations).toContain('aria-busy={busy}');
  });
});
