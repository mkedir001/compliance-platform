import { describe, expect, it } from "vitest";
import { usDateToInputValue } from "@/app/admin/clients/import-review";

describe("date from an extracted proposal to a document expiration", () => {
  it("converts US dates to date-input values and rejects non-dates", () => {
    expect(usDateToInputValue("7/1/2023")).toBe("2023-07-01");
    expect(usDateToInputValue("07/01/23")).toBe("2023-07-01");
    expect(usDateToInputValue("06/7/2022")).toBe("2022-06-07");
    expect(usDateToInputValue("2/30/2023")).toBeNull();
    expect(usDateToInputValue("next year")).toBeNull();
    expect(usDateToInputValue(undefined)).toBeNull();
  });
});
