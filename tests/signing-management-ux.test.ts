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

  it("labels unsigned source, signed final, evidence, and multi-signer progress distinctly",()=>{
    const portal=source("src","app","admin","clients","clients-portal.tsx");
    expect(portal).toContain("Preview unsigned frozen document");
    expect(portal).toContain("View / download current signed document");
    expect(portal).toContain("View frozen unsigned source");
    expect(portal).toContain("View / download signed PDF");
    expect(portal).toContain("View original frozen document");
    expect(portal).toContain("Download signature evidence");
    expect(portal).toContain("required signatures completed");
    expect(portal).not.toContain(">Preview / download PDF<");
  });
});
