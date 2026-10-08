import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("unified client directory and add-client workflow",()=>{
  const portal=source("src/app/admin/clients/clients-portal.tsx"),drawer=source("src/app/admin/clients/add-client-drawer.tsx"),review=source("src/app/admin/clients/client-import-workflow.tsx"),styles=source("src/app/globals.css");

  it("uses one directory entry point and authoritative non-health columns",()=>{
    expect(portal.match(/Add client<\/button>/g)).toHaveLength(1);
    for(const label of ["Client","Status","Services","Documentation","Signatures"])expect(portal).toContain(`<span>${label}</span>`);
    expect(portal).not.toContain("Add Client → Import Existing Documents");
    expect(portal).toContain("List views leave out health details.");
  });

  it("implements an accessible responsive drawer with state-preserving methods",()=>{
    for(const value of ['role="dialog"','aria-modal="true"','role="radiogroup"','Upload documents','Enter details','event.key==="Escape"','event.key==="Tab"','"ArrowLeft"','returnFocus.current?.focus()'])expect(drawer).toContain(value);
    for(const field of ["Legal first name","Legal last name","Preferred name","Date of birth","MA / PMI","Phone","Email"])expect(drawer).toContain(field);
    expect(drawer).toContain('dateOfBirth:details.dateOfBirth||undefined');
    expect(styles).toContain(".add-client-drawer");
    expect(styles).toContain("@media(max-width:620px)");
  });

  it("validates and preserves multi-PDF selections before a durable full-page handoff",()=>{
    for(const value of ["MAX_FILES=20","MAX_FILE_BYTES=25_000_000","MAX_TOTAL_BYTES=50_000_000","Only PDF files can be uploaded.","Uploading documents…","Preparing review…","Opening review…","No client is created by this upload."])expect(drawer).toContain(value);
    expect(drawer).toContain("crypto.randomUUID()");
    expect(portal).toContain("importSessionId");
    expect(review).toContain('standalone?<section className="import-review-page"');
  });

  it("keeps unfinished imports resumable and requires confirmation before discard",()=>{
    expect(portal).toContain("You have an import waiting for review");
    expect(portal).toContain("Resume review");
    expect(portal).toContain("pendingImports.length");
    expect(review).toContain("window.confirm");
    expect(review).toContain("Discard import");
  });

  it("guards duplicate submission and preserves actionable failure state",()=>{
    expect(drawer).toContain("if(busy)return");
    expect(drawer).toContain("disabled={busy}");
    expect(drawer).toContain("Your selected files are still available to retry.");
    expect(drawer).toContain('role="alert"');
    expect(portal).toContain("await load();if(initialClientId)");
    expect(portal).toContain("await open(initialClientId)");
  });
});
