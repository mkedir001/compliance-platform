import { describe, expect, it } from "vitest";
import { usDateToInputValue } from "@/app/admin/clients/import-review";

describe("explicit reviewed document dates", () => {
  it("converts valid explicit dates to date-input values and rejects unsupported values", () => {
    expect(usDateToInputValue("7/1/2023")).toBe("2023-07-01");
    expect(usDateToInputValue("07/01/23")).toBe("2023-07-01");
    expect(usDateToInputValue("06/7/2022")).toBe("2022-06-07");
    expect(usDateToInputValue("2/30/2023")).toBeNull();
    expect(usDateToInputValue("next year")).toBeNull();
    expect(usDateToInputValue(undefined)).toBeNull();
  });

  it("does not classify a period end as an expiration field",async()=>{const source=await import("node:fs/promises").then(fs=>fs.readFile("src/domain/clients/imports.ts","utf8"));expect(source).not.toContain('fieldPath==="document.periodEnd"');expect(source).not.toContain("withAcceptedExpiration")});
});
