/**
 * Pure helpers for the medication administration record (MAR). Dates are plain `YYYY-MM-DD` day keys so a
 * transferred paper MAR keeps the day each dose was due, regardless of when it was typed in or signed.
 */
export const MAR_SIGNING_CONSENT_VERSION = "mar-typed-signature-v1";
export const MAR_SIGNING_CONSENT_TEXT = "I adopt this typed name as my signature. Applying it to a medication record means I administered, observed, or reviewed what is recorded.";

export type DoseStatus = "GIVEN" | "REFUSED" | "HELD" | "NOT_GIVEN";
export const DOSE_STATUSES: readonly DoseStatus[] = ["GIVEN", "REFUSED", "HELD", "NOT_GIVEN"];
export const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
export const timeKeyPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The one fixed row used when a medication has no schedule time we can read. */
export const UNSCHEDULED_TIME = "00:00";

export function isDayKey(value: string) {
  if (!dayKeyPattern.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const dateToDayKey = (date: Date) => date.toISOString().slice(0, 10);
export function addDays(key: string, days: number) { const date = dayKeyToDate(key); date.setUTCDate(date.getUTCDate() + days); return dateToDayKey(date); }
export function todayKey(now = new Date(), timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

/** Monday of the week containing `key`. */
export function weekStartKey(key: string) {
  const day = dayKeyToDate(key).getUTCDay(); // 0 Sunday
  return addDays(key, -((day + 6) % 7));
}

export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month must be YYYY-MM");
  const [year, mon] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
export function monthWeeks(month: string) {
  const days = monthDays(month), starts = new Set(days.map(weekStartKey));
  return [...starts].sort().map(start => ({ weekStart: start, weekEnd: addDays(start, 6), firstDay: days.find(day => weekStartKey(day) === start)!, lastDay: [...days].reverse().find(day => weekStartKey(day) === start)! }));
}

const twelveHour = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i;
const twentyFour = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const named: Record<string, string> = { morning: "08:00", breakfast: "08:00", noon: "12:00", lunch: "12:00", afternoon: "14:00", dinner: "17:00", evening: "18:00", supper: "17:00", bedtime: "21:00", night: "21:00", hs: "21:00" };

/** Turns free text such as "8 AM, 8 PM" or "0800/2000" into unique sorted `HH:mm` slots. */
export function parseScheduleTimes(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const slots = new Set<string>();
  for (const raw of text.split(/[,;/]|\band\b|&|\n/i)) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    let match = twelveHour.exec(token);
    if (match) {
      let hour = Number(match[1]) % 12;
      if (match[3].toLowerCase() === "p") hour += 12;
      if (Number(match[1]) >= 1 && Number(match[1]) <= 12) slots.add(`${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`);
      continue;
    }
    match = twentyFour.exec(token);
    if (match) { slots.add(`${match[1].padStart(2, "0")}:${match[2]}`); continue; }
    if (/^\d{4}$/.test(token) && twentyFour.test(`${token.slice(0, 2)}:${token.slice(2)}`)) { slots.add(`${token.slice(0, 2)}:${token.slice(2)}`); continue; }
    const word = Object.keys(named).find(key => token === key || token.startsWith(`${key} `));
    if (word) slots.add(named[word]);
  }
  return [...slots].sort();
}

export function timeLabel(time: string) {
  if (time === UNSCHEDULED_TIME) return "As ordered";
  const [hour, minute] = time.split(":").map(Number), suffix = hour >= 12 ? "PM" : "AM", twelve = hour % 12 || 12;
  return minute ? `${twelve}:${String(minute).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

export type MarMedication = { id: string; medication: string; dose: string | null; times: string | null; route: string | null; startDate: string | null; stopDate: string | null };
export type MarDose = { medicationId: string; doseDate: string; scheduledTime: string; status: DoseStatus };

/** Rows of the grid: one per medication per scheduled time. Slots that hold a recorded dose are always kept. */
export function marRows(medications: readonly MarMedication[], doses: readonly MarDose[] = []) {
  return medications.flatMap(medication => {
    const slots = new Set(parseScheduleTimes(medication.times));
    for (const dose of doses) if (dose.medicationId === medication.id) slots.add(dose.scheduledTime);
    if (!slots.size) slots.add(UNSCHEDULED_TIME);
    return [...slots].sort().map(time => ({ medicationId: medication.id, time }));
  });
}

/** Whether a day is inside the period the medication is ordered for. Unknown bounds are open-ended. */
export function medicationActiveOn(medication: Pick<MarMedication, "startDate" | "stopDate">, day: string) {
  return (!medication.startDate || day >= medication.startDate) && (!medication.stopDate || day <= medication.stopDate);
}

/**
 * Administrator-only totals for a date range up to `today`. A scheduled slot with no entry counts as not
 * documented, but only when the medication has a start date or an earlier entry to anchor it.
 */
export function marSummary(medications: readonly MarMedication[], doses: readonly MarDose[], days: readonly string[], today: string) {
  const counts = { given: 0, refused: 0, held: 0, notGiven: 0, notDocumented: 0 };
  const inRange = new Set(days);
  for (const dose of doses) {
    if (!inRange.has(dose.doseDate)) continue;
    if (dose.status === "GIVEN") counts.given++; else if (dose.status === "REFUSED") counts.refused++; else if (dose.status === "HELD") counts.held++; else counts.notGiven++;
  }
  const recorded = new Set(doses.map(dose => `${dose.medicationId}|${dose.doseDate}|${dose.scheduledTime}`));
  for (const row of marRows(medications, doses)) {
    const medication = medications.find(item => item.id === row.medicationId)!;
    const earliest = doses.filter(dose => dose.medicationId === row.medicationId).map(dose => dose.doseDate).sort()[0];
    const anchor = medication.startDate ?? earliest;
    if (!anchor || row.time === UNSCHEDULED_TIME) continue;
    for (const day of days) if (day <= today && day >= anchor && medicationActiveOn(medication, day) && !recorded.has(`${row.medicationId}|${day}|${row.time}`)) counts.notDocumented++;
  }
  return counts;
}

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
