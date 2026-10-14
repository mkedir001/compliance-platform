import { describe, expect, it } from "vitest";
import { applyBillingPlan, billableVisits, classifyVisit, nonCompliantVisits, planBilling, summarizeClient, type BillingVisit } from "@/domain/billing/evv";
import { sampleBillingData } from "@/domain/billing/sample";

const gps = { latitude: "44.95", longitude: "-93.09" };
function visit(id: string, overrides: Partial<BillingVisit> = {}, clientId = "c1"): BillingVisit {
  return {
    id, clientId, caregiverName: "Alice", scheduledStart: "2026-09-01T14:00:00Z", scheduledEnd: "2026-09-01T16:00:00Z",
    clockIn: { time: "2026-09-01T14:00:00Z", method: "Mobile", coordinates: gps }, clockOut: { time: "2026-09-01T16:00:00Z", method: "Mobile", coordinates: gps },
    service: { code: "HOMEMAKING", description: "Homemaking" }, hourlyRateCents: 3000, ...overrides,
  };
}

describe("EVV classification", () => {
  it("accepts a visit with times, location, and a service", () => {
    const result = classifyVisit(visit("a"));
    expect(result).toMatchObject({ evvCompliant: true, minutes: 120, amountCents: 6000, issues: [] });
  });

  it("flags each missing element with its own reason", () => {
    expect(classifyVisit(visit("a", { clockIn: { time: "2026-09-01T14:00:00Z", coordinates: null } })).issues).toEqual(["NO_CLOCK_IN_LOCATION"]);
    expect(classifyVisit(visit("a", { clockOut: { time: null } })).issues).toEqual(["MISSING_CLOCK_OUT"]);
    expect(classifyVisit(visit("a", { service: null })).issues).toEqual(["NO_SERVICE_CODE"]);
    expect(classifyVisit(visit("a", { clockOut: { time: "2026-09-01T13:00:00Z", coordinates: gps } })).issues).toEqual(["CLOCK_OUT_BEFORE_CLOCK_IN"]);
  });

  it("treats a telephony clock event as a location", () => {
    const phone = visit("a", { clockIn: { time: "2026-09-01T14:00:00Z", telephonyPhone: "+16125550100" }, clockOut: { time: "2026-09-01T16:00:00Z", telephonyPhone: "+16125550100" } });
    expect(classifyVisit(phone).evvCompliant).toBe(true);
  });

  it("does not count AxisCare's verified flag as EVV compliance", () => {
    expect(classifyVisit(visit("a", { verified: true, clockIn: { time: "2026-09-01T14:00:00Z", coordinates: null } })).evvCompliant).toBe(false);
  });
});

describe("client rollups", () => {
  const visits = [
    visit("a"),
    visit("b", { billedRunId: "r1" }),
    visit("c", { clockOut: { time: "2026-09-02T17:30:00Z", coordinates: null }, clockIn: { time: "2026-09-02T14:00:00Z", coordinates: gps } }),
    visit("d", { clockOut: null }),
    visit("e", {}, "c2"),
  ];

  it("separates compliant from non-compliant hours and dollars", () => {
    const summary = summarizeClient("c1", visits, [{ id: "r1", clientId: "c1", billedAt: "2026-09-10T00:00:00Z", hours: 2, amountCents: 6000 }]);
    expect(summary).toMatchObject({
      visitCount: 3, totalMinutes: 120 + 120 + 210, evvMinutes: 240, nonEvvMinutes: 210,
      unbilledEvvMinutes: 120, unbilledEvvCents: 6000, billedMinutes: 120, billedCents: 6000,
      unbilledNonEvvMinutes: 210, unbilledNonEvvCents: 10500, nonEvvVisitCount: 1, lastBilledAt: "2026-09-10T00:00:00Z", runCount: 1,
    });
  });

  it("never mixes in another client's visits and ignores in-progress visits", () => {
    expect(summarizeClient("c2", visits, []).visitCount).toBe(1);
    expect(nonCompliantVisits("c1", visits).map(item => item.id)).toEqual(["c", "d"]);
    expect(billableVisits("c1", visits).map(item => item.id)).toEqual(["a"]);
  });
});

describe("billing plans", () => {
  const visits = [visit("a"), visit("b", { billedRunId: "r1" }), visit("c", {}, "c2"), visit("x", { service: null }, "c3")];

  it("includes only compliant, unbilled visits and reports clients with nothing to bill", () => {
    const plan = planBilling(["c1", "c2", "c3", "c1"], visits, "INDIVIDUAL");
    expect(plan.lines.map(line => [line.clientId, line.amountCents])).toEqual([["c1", 6000], ["c2", 6000]]);
    expect(plan).toMatchObject({ totalCents: 12000, totalMinutes: 240, skipped: ["c3"] });
  });

  it("gives the same totals for a group as for individual invoices but one run", () => {
    const individual = applyBillingPlan(visits, planBilling(["c1", "c2"], visits, "INDIVIDUAL"), "2026-10-01T00:00:00Z", index => `run-${index}`);
    const group = applyBillingPlan(visits, planBilling(["c1", "c2"], visits, "GROUP"), "2026-10-01T00:00:00Z", index => `run-${index}`);
    expect(individual.runs.map(run => run.id)).toEqual(["run-0", "run-1"]);
    expect(group.runs.map(run => run.id)).toEqual(["run-0", "run-0"]);
    expect(group.runs.reduce((sum, run) => sum + run.amountCents, 0)).toBe(12000);
    expect(group.visits.find(item => item.id === "a")?.billedRunId).toBe("run-0");
    expect(group.visits.find(item => item.id === "x")?.billedRunId).toBeUndefined();
  });

  it("cannot bill the same visits twice", () => {
    const first = applyBillingPlan(visits, planBilling(["c1"], visits, "INDIVIDUAL"), "2026-10-01T00:00:00Z", () => "run-1");
    expect(planBilling(["c1"], first.visits, "INDIVIDUAL").lines).toEqual([]);
  });
});

describe("sample data", () => {
  it("is deterministic and contains both compliant and non-compliant visits", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const a = sampleBillingData(["c1", "c2"], now), b = sampleBillingData(["c1", "c2"], now);
    expect(a).toEqual(b);
    const summary = summarizeClient("c1", a.visits, a.runs);
    expect(summary.nonEvvMinutes).toBeGreaterThan(0);
    expect(summary.unbilledEvvMinutes).toBeGreaterThan(0);
    expect(summary.billedCents).toBeGreaterThan(0);
  });
});
