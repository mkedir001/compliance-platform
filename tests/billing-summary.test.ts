import { describe, expect, it } from "vitest";
import { hoursWithAmount, summarizeVisits } from "@/app/admin/billing/billing-shared";

const visit = (compliant: boolean, hours: number | null, rateCents: number | null) => ({ compliant, hours, rateCents, amountCents: hours !== null && rateCents !== null ? Math.round(hours * rateCents) : null });

describe("billing snapshot figures", () => {
  it("counts EVV and non-EVV visits and totals every unsubmitted visit as ready to bill", () => {
    const s = summarizeVisits([visit(true, 2, 2500), visit(true, 1.5, 2500), visit(false, 3, 2500), visit(false, null, 2500)]);
    expect(s).toMatchObject({ evvCount: 2, nonEvvCount: 2, readyHours: 6.5, readyCents: 16250, unrated: false });
    expect(s.evv).toMatchObject({ hours: 3.5, cents: 8750 });
    expect(s.nonEvv).toMatchObject({ hours: 3, cents: 7500 });
  });
  it("flags visits that have hours but no rate", () => { expect(summarizeVisits([visit(true, 2, null)]).unrated).toBe(true); expect(summarizeVisits([visit(false, null, null)]).unrated).toBe(false); });
  it("is empty and safe for a client with no visits", () => { expect(summarizeVisits([])).toMatchObject({ evvCount: 0, nonEvvCount: 0, readyHours: 0, readyCents: 0 }); });
  it("formats hours with the amount in brackets", () => { expect(hoursWithAmount(14.5, 36250)).toBe("14.50 h ($362.50)"); expect(hoursWithAmount(2, 5000, true)).toBe("2.00 h ($50.00+)"); });
});
