import { describe, expect, it } from "vitest";
import { initialsFor, isDayKey, marRows, marSummary, monthDays, monthWeeks, parseScheduleTimes, timeLabel, todayKey, UNSCHEDULED_TIME, weekStartKey } from "@/domain/clients/mar";

const med = (over: Partial<Parameters<typeof marRows>[0][number]> = {}) => ({ id: "m1", medication: "Lamotrigine", dose: "100 mg", times: "8 AM, 8 PM", route: null, startDate: "2026-10-01", stopDate: null, ...over });

describe("MAR schedule parsing", () => {
  it("reads 12-hour, 24-hour and named times", () => {
    expect(parseScheduleTimes("8 AM, 8 PM")).toEqual(["08:00", "20:00"]);
    expect(parseScheduleTimes("0800/2000")).toEqual(["08:00", "20:00"]);
    expect(parseScheduleTimes("9:30pm and bedtime")).toEqual(["21:00", "21:30"]);
    expect(parseScheduleTimes("12 AM, 12 PM")).toEqual(["00:00", "12:00"]);
    expect(parseScheduleTimes("as needed")).toEqual([]);
    expect(parseScheduleTimes(null)).toEqual([]);
  });
  it("labels times for the grid", () => {
    expect(timeLabel("08:00")).toBe("8 AM");
    expect(timeLabel("20:30")).toBe("8:30 PM");
    expect(timeLabel(UNSCHEDULED_TIME)).toBe("As ordered");
  });
});

describe("MAR dates", () => {
  it("validates real calendar days", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("10/17/2026")).toBe(false);
  });
  it("finds the Monday of a week and the weeks in a month", () => {
    expect(weekStartKey("2026-10-21")).toBe("2026-10-19");
    expect(weekStartKey("2026-10-18")).toBe("2026-10-12");
    expect(monthDays("2026-02")).toHaveLength(28);
    const weeks = monthWeeks("2026-10");
    expect(weeks[0]).toMatchObject({ weekStart: "2026-09-28", firstDay: "2026-10-01" });
    expect(weeks.at(-1)).toMatchObject({ weekStart: "2026-10-26", lastDay: "2026-10-31" });
  });
  it("computes today in Central time", () => {
    expect(todayKey(new Date("2026-10-22T03:30:00Z"))).toBe("2026-10-21");
  });
});

describe("MAR rows and admin summary", () => {
  it("keeps a row for a recorded dose even when the schedule text changed", () => {
    const rows = marRows([med({ times: "8 AM" })], [{ medicationId: "m1", doseDate: "2026-10-02", scheduledTime: "20:00", status: "GIVEN" }]);
    expect(rows.map(row => row.time)).toEqual(["08:00", "20:00"]);
    expect(marRows([med({ times: null })])).toEqual([{ medicationId: "m1", time: UNSCHEDULED_TIME }]);
  });
  it("counts statuses and unrecorded slots up to today only", () => {
    const days = monthDays("2026-10").slice(0, 3);
    const doses = [
      { medicationId: "m1", doseDate: "2026-10-01", scheduledTime: "08:00", status: "GIVEN" as const },
      { medicationId: "m1", doseDate: "2026-10-01", scheduledTime: "20:00", status: "REFUSED" as const },
      { medicationId: "m1", doseDate: "2026-10-02", scheduledTime: "08:00", status: "HELD" as const },
    ];
    expect(marSummary([med()], doses, days, "2026-10-03")).toEqual({ given: 1, refused: 1, held: 1, notGiven: 0, notDocumented: 3 });
    expect(marSummary([med({ startDate: null })], [], days, "2026-10-03").notDocumented).toBe(0);
    expect(marSummary([med({ stopDate: "2026-10-01" })], doses, days, "2026-10-03").notDocumented).toBe(0);
  });
});

describe("initials", () => {
  it("uses first and last name", () => { expect(initialsFor("Amina Bashir")).toBe("AB"); expect(initialsFor("Cher")).toBe("CH"); });
});
