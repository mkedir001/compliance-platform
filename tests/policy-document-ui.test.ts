import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");

describe("policy, document, and navigation UI contracts",()=>{
 it("supports reviewed metadata and both selected and all-eligible policy assignment",()=>{const source=read("src/app/admin/policy-operations/policy-operations.tsx");expect(source).toContain("Save reviewed metadata");expect(source).toContain('action:"CORRECT_METADATA"');expect(source).toContain('name="allEligible"');expect(source).toContain('"ALL_ELIGIBLE":"SELECTED"')});
 it("exposes an employee Policies tab with Sign Now but no employee administration controls",()=>{const source=read("src/app/learn/portal.tsx");expect(source).toContain('"policies"');expect(source).toContain("Sign now");expect(source).not.toContain("Upload Policy");expect(source).not.toContain("Publish Policy")});
 it("stores client uploads before optional analysis",()=>{const source=read("src/app/admin/clients/client-import-workflow.tsx");expect(source).toContain("securely stored. Analysis is optional");expect(source).not.toContain("await processPending(created)");expect(source).toContain("Analyze selected documents")});
 it("removes client signature/readiness tabs while preserving Documents and adds authorized billing",()=>{const source=read("src/app/admin/clients/clients-portal.tsx");expect(source).toContain('const tabs = ["Overview", "Intake", "Services", "Documents", "Care profile", "Contacts"');expect(source).toContain('permissions.includes("organization.manage")?["Billing"]');expect(source).toContain('["Documents","Signatures","Readiness"].includes(initialView)?"Documents"')});
 it("adds blank organization billing navigation and uses the compact Certifications label",()=>{expect(read("src/app/components/portal-ui.tsx")).toContain('label: "Billing"');expect(read("src/app/admin/billing/page.tsx")).toContain('requirePermission(membership.id,"organization.manage")');expect(read("src/app/admin/operations-portal.tsx")).toContain('certifications:"Certifications"')});
});
