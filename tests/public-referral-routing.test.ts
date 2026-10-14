import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/referrals/[token]/route";
import { GET as publicGet, POST as publicPost } from "@/app/api/public/referrals/[token]/route";

describe("external referral routing boundary", () => {
  it("exposes only the token-scoped handlers through the dedicated public namespace", () => {
    expect(publicGet).toBe(legacyGet);
    expect(publicPost).toBe(legacyPost);
  });

  it("uses the public namespace from the external form without widening internal referral APIs", () => {
    const source = readFileSync("src/app/refer/[token]/referral-form.tsx", "utf8");
    expect(source).toContain("/api/public/referrals/${token}");
    expect(source).not.toContain("fetch(`/api/referrals/${token}");
    expect(source).not.toContain("/api/organizations/");
  });
});
