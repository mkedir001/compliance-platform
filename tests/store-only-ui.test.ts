import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
describe("store-only and care-profile-only upload UI", () => {
  const workflow = read("src/app/admin/clients/client-import-workflow.tsx");
  const portal = read("src/app/admin/clients/clients-portal.tsx");
  const route = read("src/app/api/organizations/[organizationId]/clients/imports/route.ts");
  const domain = read("src/domain/clients/imports.ts");
  it("offers three choices for an existing client, with store-only skipping extraction", () => {
    for (const text of ["Store only", "Review for the care profile only", "Review for the full client record"]) expect(workflow).toContain(text);
    expect(workflow).toContain('action:"STORE_ONLY"');
    expect(workflow).toContain('scope:existingClientId&&uploadMode==="CARE_PROFILE_ONLY"');
  });
  it("routes the new actions and keeps care-only confirmation away from non-care records", () => {
    expect(route).toContain('"STORE_ONLY"');
    expect(route).toContain('"STAGE_FROM_DOCUMENTS"');
    expect(domain).toContain('session.scope==="CARE_PROFILE_ONLY"');
    expect(domain).toContain("sourceClientDocumentId");
  });
  it("lets a stored document be reviewed for the care profile later", () => {
    expect(portal).toContain("Review for care profile");
    expect(portal).toContain("STAGE_FROM_DOCUMENTS");
  });
});

describe("upload mode layout", () => {
  const workflow = readFileSync("src/app/admin/clients/client-import-workflow.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  it("keeps native radio semantics and synchronizes each visible selection with its submitted mode", () => {
    for (const mode of ["STORE_ONLY", "CARE_PROFILE_ONLY", "FULL"]) {
      expect(workflow).toContain(`value="${mode}"`);
      expect(workflow).toContain(`className={uploadMode==="${mode}"?"selected":""}`);
      expect(workflow).toContain(`checked={uploadMode==="${mode}"}`);
      expect(workflow).toContain(`onChange={()=>setUploadMode("${mode}")}`);
    }
  });
  it("overrides the inline-form label grid and provides selected, focus, touch, and mobile states", () => {
    expect(css).toContain(".inline-form .upload-mode label{display:flex");
    expect(css).toMatch(/\.inline-form \.upload-mode input\[type="radio"\]\{[^}]*width:18px[^}]*padding:0/);
    expect(css).toContain(".inline-form .upload-mode label.selected");
    expect(css).toContain(".inline-form .upload-mode label:focus-within");
    expect(css).toContain("min-height:44px");
    expect(css).toContain("@media(max-width:480px)");
  });
});
