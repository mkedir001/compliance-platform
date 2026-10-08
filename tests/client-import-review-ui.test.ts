import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source=(path:string)=>readFileSync(path,"utf8");
describe("client import review UI",()=>{
  it("implements the compact five-field, persisted, dual-view review and actionable confirmation blockers",()=>{const workflow=source("src/app/admin/clients/client-import-workflow.tsx"),styles=source("src/app/globals.css");for(const expected of ["slice(page*5,page*5+5)","Accept all remaining","Upload more files","UI view","PDF view","Finish later","Confirm and create client","Completion date","Go to issue","Your progress is saved","RESOLVE_CONFLICT","APPEND","SETTINGS"])expect(workflow).toContain(expected);expect(workflow).toContain("authoritative-document-preview");expect(workflow).toContain("disabled={busy||Boolean(blockers)}");expect(styles).toContain(".import-pdf-layout");expect(styles).toContain("@media(max-width:600px)")});
});
