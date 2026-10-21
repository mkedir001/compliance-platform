import { describe, expect, it } from "vitest";
import { billedThisYear, evvRate, percentLabel, reportingPeriods } from "@/app/admin/billing/billing-shared";

const now = new Date("2026-10-21T17:00:00Z");
const v = (startAt: string, compliant: boolean) => ({ startAt, compliant });
describe("EVV rate periods", () => {
  it("uses the Central calendar quarter", () => {
    expect(reportingPeriods(now).label).toBe("Q4 2026");
    expect(reportingPeriods(new Date("2026-10-01T03:00:00Z")).label).toBe("Q3 2026"); // still Sept 30 evening in Chicago
    expect(reportingPeriods(new Date("2027-01-01T07:00:00Z")).label).toBe("Q1 2027");
  });
  it("rates the whole quarter and year by visit count", () => {
    const visits = [v("2026-10-02T15:00:00Z", true), v("2026-10-10T15:00:00Z", true), v("2026-10-12T15:00:00Z", false), v("2026-08-01T15:00:00Z", false), v("2025-12-01T15:00:00Z", false)];
    expect(evvRate(visits, "QUARTER", now)).toEqual({ total: 3, compliant: 2, percent: 66.7 });
    expect(evvRate(visits, "YEAR", now)).toEqual({ total: 4, compliant: 2, percent: 50 });
    expect(evvRate([], "QUARTER", now).percent).toBeNull();
    expect(percentLabel(null)).toBe("—");
  });
  it("reports billed totals only once the ledger carries results", () => {
    expect(billedThisYear([{ startAt: "2026-10-02T15:00:00Z" }], now)).toBeNull();
    const billed = { status: "BILLED" as const, amountCents: 5000, reference: null, at: "x", startedBy: null };
    expect(billedThisYear([{ startAt: "2026-02-02T15:00:00Z", result: billed }, { startAt: "2025-02-02T15:00:00Z", result: billed }, { startAt: "2026-03-02T15:00:00Z", result: null }], now)).toBe(5000);
  });
});
