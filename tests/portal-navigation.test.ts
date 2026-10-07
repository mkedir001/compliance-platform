import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { portalLocation, portalLocationState } from "@/app/admin/portal-navigation";

describe("employer portal navigation state", () => {
  const training = "http://localhost:3000/admin/compliance-operations?organizationId=org-1&view=training&employeeId=employee-1&assignmentId=assignment-1";

  it("keeps Training → Compliance → Dashboard on the explicit destination", () => {
    const compliance=portalLocation(training,"org-1","compliance");
    expect(portalLocationState(compliance.href)).toEqual({tab:"compliance",employeeId:undefined,assignmentId:undefined,employeeTab:"overview"});
    const dashboard=portalLocation(compliance.href,"org-1","dashboard");
    expect(portalLocationState(dashboard.href)).toEqual({tab:"dashboard",employeeId:undefined,assignmentId:undefined,employeeTab:"overview"});
    expect(dashboard.searchParams.has("view")).toBe(false);
  });

  it("clears stale training selection for every adjacent top-level destination", () => {
    for(const tab of ["employees","policies","evidence","medication","audit"] as const){
      const destination=portalLocation(training,"org-1",tab);
      expect(destination.searchParams.get("view")).toBe(tab);
      expect(destination.searchParams.has("employeeId")).toBe(false);
      expect(destination.searchParams.has("assignmentId")).toBe(false);
    }
  });

  it("preserves employee and assignment selection only for Training", () => {
    const destination=portalLocation("http://localhost:3000/admin/compliance-operations?organizationId=org-1","org-1","training",{employeeId:"employee-2",assignmentId:"assignment-2"});
    expect(portalLocationState(destination.href)).toEqual({tab:"training",employeeId:"employee-2",assignmentId:"assignment-2",employeeTab:"overview"});
  });

  it("deep-links employee tabs without leaking record state into top-level navigation", () => {
    const employee=portalLocation("http://localhost:3000/admin/compliance-operations?organizationId=org-1","org-1","employees",{employeeId:"employee-2",employeeTab:"training"});
    expect(portalLocationState(employee.href)).toEqual({tab:"employees",employeeId:"employee-2",assignmentId:undefined,employeeTab:"training"});
    const compliance=portalLocation(employee.href,"org-1","compliance");
    expect(compliance.searchParams.has("employeeId")).toBe(false);
    expect(compliance.searchParams.has("employeeTab")).toBe(false);
    const restored=portalLocation(compliance.href,"org-1","employees",{employeeId:"employee-2",employeeTab:"history"});
    expect(portalLocationState(restored.href).employeeTab).toBe("history");
  });

  it("uses read-oriented copy for Dashboard and reserves reconciliation copy for the mutation", async () => {
    const source=await readFile("src/app/admin/operations-portal.tsx","utf8");
    expect(source).toContain("Loading dashboard…");
    expect(source).toContain("Reconciling authoritative records…");
    expect(source).not.toContain("Updating authoritative records…");
  });
});
