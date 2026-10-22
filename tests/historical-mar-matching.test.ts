import { describe, expect, it } from "vitest";
import { buildMedicationOccurrences, localTimeCandidates, matchHistoricalOccurrence, type HistoricalVisit, type MedicationVersion } from "@/domain/clients/historical-mar-matching";

const visit = (over: Partial<HistoricalVisit> = {}): HistoricalVisit => ({ id: "visit-1", externalId: "axis-visit-1", employeeId: "employee-1", axisCareCaregiverId: "axis-caregiver-1", clockInAt: new Date("2026-01-15T13:00:00Z"), clockOutAt: new Date("2026-01-15T21:00:00Z"), scheduledStartAt: new Date("2026-01-15T13:00:00Z"), scheduledEndAt: new Date("2026-01-15T21:00:00Z"), removed: false, modificationReason: null, ...over });

describe("historical MAR AxisCare matching", () => {
  it("attributes only a unique actual clock window", () => {
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit()])).toMatchObject({ state: "MATCHED", employeeId: "employee-1", confidence: "ACTUAL_CLOCK_COVERAGE" });
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit(), visit({ id: "visit-2", externalId: "axis-visit-2" })])).toMatchObject({ state: "AMBIGUOUS_VISIT", employeeId: null });
  });

  it("handles overnight actual shifts without treating schedule as attendance", () => {
    const overnight = visit({ clockInAt: new Date("2026-01-16T03:00:00Z"), clockOutAt: new Date("2026-01-16T11:00:00Z"), scheduledStartAt: new Date("2026-01-16T03:00:00Z"), scheduledEndAt: new Date("2026-01-16T11:00:00Z") });
    expect(matchHistoricalOccurrence("2026-01-15", "23:30", "America/Chicago", [overnight]).state).toBe("MATCHED");
    const noClock = visit({ clockInAt: null, clockOutAt: null });
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [noClock])).toMatchObject({ state: "MISSING_CLOCK_IN", confidence: "SCHEDULED_WINDOW_ONLY" });
  });

  it("flags missing clock-outs, missing caregiver mappings, and canceled visits", () => {
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit({ clockOutAt: null })]).state).toBe("MISSING_CLOCK_OUT");
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit({ employeeId: null })]).state).toBe("MISSING_CAREGIVER_MAPPING");
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit({ removed: true })]).state).toBe("NO_ACTUAL_VISIT");
    expect(matchHistoricalOccurrence("2026-01-15", "08:00", "America/Chicago", [visit({ modificationReason: "Canceled by agency" })]).state).toBe("NO_ACTUAL_VISIT");
  });

  it("handles daylight-saving gaps and overlaps explicitly", () => {
    expect(localTimeCandidates("2026-03-08", "02:30", "America/Chicago")).toHaveLength(0);
    expect(localTimeCandidates("2026-11-01", "01:30", "America/Chicago")).toHaveLength(2);
    const first = localTimeCandidates("2026-11-01", "01:30", "America/Chicago")[0];
    expect(matchHistoricalOccurrence("2026-11-01", "01:30", "America/Chicago", [visit({ clockInAt: new Date(first.getTime() - 600_000), clockOutAt: new Date(first.getTime() + 600_000) })]).state).toBe("MATCHED");
  });
});

describe("historical medication schedules", () => {
  const version = (over: Partial<MedicationVersion> = {}): MedicationVersion => ({ medicationId: "med-1", medication: "Synthetic medication", dose: "1 unit", route: "oral", times: "8 AM", startDate: "2026-01-01", stopDate: null, approved: true, source: "current", ...over });
  it("honors effective start and discontinuation dates", () => {
    const rows = buildMedicationOccurrences([version({ stopDate: "2026-01-02" })], "2026-01-01", "2026-01-04");
    expect(rows.map(row => row.day)).toEqual(["2026-01-01", "2026-01-02"]);
  });
  it("flags pending schedules rather than silently treating them as approved", () => {
    expect(buildMedicationOccurrences([version({ approved: false })], "2026-01-01", "2026-01-01")[0].scheduleState).toBe("MEDICATION_NOT_APPROVED");
  });
  it("flags conflicting historical schedule snapshots rather than guessing", () => {
    const rows = buildMedicationOccurrences([version(), version({ source: "history:old", times: "8 PM" })], "2026-01-01", "2026-01-01");
    expect(rows.map(row => row.scheduleState)).toEqual(["MEDICATION_HISTORY_GAP", "MEDICATION_HISTORY_GAP"]);
  });
});
