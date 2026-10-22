import { createHash } from "node:crypto";
import { addDays, isDayKey, medicationActiveOn, parseScheduleTimes } from "./mar";

export const HISTORICAL_MAR_ALGORITHM_VERSION = "historical-mar-v1";

export type HistoricalVisit = {
  id: string;
  externalId: string;
  employeeId: string | null;
  axisCareCaregiverId: string | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  removed: boolean;
  modificationReason: string | null;
};

export type HistoricalMatchState =
  | "MATCHED"
  | "AMBIGUOUS_VISIT"
  | "NO_ACTUAL_VISIT"
  | "MISSING_CLOCK_IN"
  | "MISSING_CLOCK_OUT"
  | "MISSING_CAREGIVER_MAPPING";

export type HistoricalMatch = {
  state: HistoricalMatchState;
  confidence: string;
  visitId: string | null;
  employeeId: string | null;
  candidates: string[];
};

const partsAt = (instant: Date, timeZone: string) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
};

function offsetAt(instant: Date, timeZone: string) {
  const local = partsAt(instant, timeZone);
  const interpreted = Date.parse(`${local.day}T${local.time}:00.000Z`);
  return interpreted - instant.getTime() + instant.getUTCSeconds() * 1_000 + instant.getUTCMilliseconds();
}

/** Returns zero instants for a spring-forward gap and two for a fall-back overlap. */
export function localTimeCandidates(day: string, time: string, timeZone: string) {
  if (!isDayKey(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
  const nominal = Date.parse(`${day}T${time}:00.000Z`);
  const probes = [nominal - 18 * 3_600_000, nominal, nominal + 18 * 3_600_000];
  const candidates = new Map<number, Date>();
  for (const probe of probes) {
    const value = new Date(nominal - offsetAt(new Date(probe), timeZone));
    const local = partsAt(value, timeZone);
    if (local.day === day && local.time === time) candidates.set(value.getTime(), value);
  }
  return [...candidates.values()].sort((a, b) => a.getTime() - b.getTime());
}

const covers = (start: Date | null, end: Date | null, occurrence: Date) => Boolean(start && end && start <= occurrence && occurrence <= end);
const canceled = (visit: HistoricalVisit) => visit.removed || /cancel/i.test(visit.modificationReason ?? "");

/**
 * Attributes a scheduled occurrence only when actual AxisCare clock evidence covers it.
 * Scheduled visit times are used solely to explain incomplete evidence; they never prove attendance.
 */
export function matchHistoricalOccurrence(day: string, time: string, timeZone: string, visits: readonly HistoricalVisit[]): HistoricalMatch {
  const instants = localTimeCandidates(day, time, timeZone);
  if (!instants.length) return { state: "NO_ACTUAL_VISIT", confidence: "INVALID_LOCAL_TIME", visitId: null, employeeId: null, candidates: [] };
  const active = visits.filter(visit => !canceled(visit));
  const actual = active.filter(visit => instants.some(instant => covers(visit.clockInAt, visit.clockOutAt, instant)));
  if (actual.length > 1) return { state: "AMBIGUOUS_VISIT", confidence: "MULTIPLE_ACTUAL_CLOCK_WINDOWS", visitId: null, employeeId: null, candidates: actual.map(v => v.externalId).sort() };
  if (actual.length === 1) {
    const visit = actual[0];
    if (!visit.employeeId || !visit.axisCareCaregiverId) return { state: "MISSING_CAREGIVER_MAPPING", confidence: "ACTUAL_CLOCK_COVERAGE_UNMAPPED", visitId: visit.id, employeeId: null, candidates: [visit.externalId] };
    return { state: "MATCHED", confidence: "ACTUAL_CLOCK_COVERAGE", visitId: visit.id, employeeId: visit.employeeId, candidates: [visit.externalId] };
  }
  const scheduled = active.filter(visit => instants.some(instant => covers(visit.scheduledStartAt, visit.scheduledEndAt, instant)));
  if (scheduled.some(visit => !visit.clockInAt)) return { state: "MISSING_CLOCK_IN", confidence: "SCHEDULED_WINDOW_ONLY", visitId: null, employeeId: null, candidates: scheduled.map(v => v.externalId).sort() };
  if (scheduled.some(visit => visit.clockInAt && !visit.clockOutAt)) return { state: "MISSING_CLOCK_OUT", confidence: "INCOMPLETE_ACTUAL_CLOCK_WINDOW", visitId: null, employeeId: null, candidates: scheduled.map(v => v.externalId).sort() };
  return { state: "NO_ACTUAL_VISIT", confidence: "NO_ACTUAL_CLOCK_COVERAGE", visitId: null, employeeId: null, candidates: [] };
}

export type MedicationVersion = {
  medicationId: string;
  medication: string;
  dose: string | null;
  route: string | null;
  times: string | null;
  startDate: string | null;
  stopDate: string | null;
  approved: boolean;
  source: string;
};

export type MedicationOccurrence = {
  medicationId: string;
  medication: string;
  dose: string | null;
  route: string | null;
  day: string;
  scheduledTime: string;
  scheduleState: "APPROVED" | "MEDICATION_NOT_APPROVED" | "MEDICATION_HISTORY_GAP";
  scheduleSources: string[];
};

/** Conflicting schedule snapshots are surfaced for review instead of choosing one. */
export function buildMedicationOccurrences(versions: readonly MedicationVersion[], rangeStart: string, rangeEnd: string) {
  const output: MedicationOccurrence[] = [];
  const medicationIds = [...new Set(versions.map(v => v.medicationId))];
  for (const medicationId of medicationIds) {
    const all = versions.filter(version => version.medicationId === medicationId);
    for (let day = rangeStart; day <= rangeEnd; day = addDays(day, 1)) {
      const active = all.filter(version => medicationActiveOn(version, day) && parseScheduleTimes(version.times).length);
      if (!active.length) continue;
      const variants = new Map<string, MedicationVersion[]>();
      for (const version of active) {
        const key = JSON.stringify({ medication: version.medication, dose: version.dose, route: version.route, times: parseScheduleTimes(version.times) });
        variants.set(key, [...(variants.get(key) ?? []), version]);
      }
      const scheduleState = variants.size > 1 ? "MEDICATION_HISTORY_GAP" : active.some(version => version.approved) ? "APPROVED" : "MEDICATION_NOT_APPROVED";
      const selected = active;
      const representative = active.find(version => version.source === "current") ?? active[0];
      const times = [...new Set(selected.flatMap(version => parseScheduleTimes(version.times)))].sort();
      for (const scheduledTime of times) output.push({ medicationId, medication: representative.medication, dose: representative.dose, route: representative.route, day, scheduledTime, scheduleState, scheduleSources: active.map(v => v.source).sort() });
    }
  }
  return output;
}

export function stableHistoricalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
