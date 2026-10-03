import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source=(...parts:string[])=>readFileSync(join(process.cwd(),...parts),"utf8");

describe("facilitated signing and document lifecycle UX",()=>{
  it("keeps remote close wording while giving facilitated completion a server-provided return action",()=>{
    const signing=source("src","app","sign","[token]","signing-experience.tsx"),domain=source("src","domain","clients","signatures.ts"),returnRoute=source("src","app","sign","[token]","return","route.ts");
    expect(signing).toContain("Return to Documents");
    expect(signing).toContain("You may close this page.");
    expect(signing).toContain("session.returnUrl");
    expect(domain).toContain("/admin/clients?organizationId=");
    expect(domain).not.toContain("returnUrl: z.");
    expect(returnRoute).toContain("location:path");
    expect(returnRoute).not.toContain("new URL(path,request.url)");
  });

  it("uses plain adopted-name presentation and revalidates persisted management state on return",()=>{
    const signing=source("src","app","sign","[token]","signing-experience.tsx"),portal=source("src","app","admin","clients","clients-portal.tsx");
    expect(signing).toContain('className="typed-signature"');
    expect(signing).not.toContain("/s/");
    expect(portal).toContain('window.addEventListener("pageshow", revalidate)');
    expect(portal).toContain('document.addEventListener("visibilitychange", revalidate)');
  });

  it("exposes only the current authoritative document action and signer-row controls",()=>{
    const portal=source("src","app","admin","clients","clients-portal.tsx");
    expect(portal).toContain("Preview document");
    expect(portal).toContain("View current signed document");
    expect(portal).toContain("View signed document");
    expect(portal).not.toContain("View frozen unsigned source");
    expect(portal).not.toContain("View original frozen document");
    expect(portal).toContain("Download signature evidence");
    expect(portal).toContain("signatures completed");
    expect(portal).toContain("Required signatures");
    expect(portal).toContain("Send for signature");
    expect(portal).toContain("Revoke");
    expect(portal).toContain('onStart(index,"SIGN_NOW",roster(),false)');
    expect(portal).not.toContain("Prepare Sign now");
    expect(portal).not.toContain("Continue to signing");
    expect(portal).toContain("Identity will be confirmed in the signing ceremony");
    expect(portal).toContain("Delivery email");
    expect(portal).toContain('remoteIndex!==null');
  });

  it("uses reusable responsive intake, directory, and document-stack layout primitives",()=>{const portal=source("src","app","admin","clients","clients-portal.tsx"),styles=source("src","app","globals.css");expect(portal).toContain("client-directory-row");expect(styles).toContain(".guided-section>section>fieldset");expect(styles).toContain(".signer-requirement");expect(portal).toContain("document-generation-actions");expect(portal).toContain("document-import-control");expect(portal).toContain("document-card-list");expect(portal).toContain("document-card");expect(styles).toContain(".document-card-list{display:grid;gap:1.25rem");expect(styles).toContain(".document-card>.signature-workflow{margin-top:1.25rem")});
});
