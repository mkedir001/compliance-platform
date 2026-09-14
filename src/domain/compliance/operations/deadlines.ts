export type TemporalStatus = "DUE" | "OVERDUE" | "EXPIRING_SOON" | "EXPIRED" | "CURRENT";

export function getExpiringSoonDays() {
  const configured = Number(process.env.COMPLIANCE_EXPIRING_SOON_DAYS ?? "30");
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
}

function localDateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function calendarDayDifference(from: Date, to: Date, timeZone: string) {
  const [fromYear, fromMonth, fromDay] = localDateKey(from, timeZone).split("-").map(Number);
  const [toYear, toMonth, toDay] = localDateKey(to, timeZone).split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
}

export function deriveTemporalStatus(input: { dueAt?: Date | null; expiresAt?: Date | null; evaluatedAt: Date; timeZone: string; expiringSoonDays?: number }): TemporalStatus {
  if (input.expiresAt) {
    const days = calendarDayDifference(input.evaluatedAt, input.expiresAt, input.timeZone);
    if (days < 0) return "EXPIRED";
    if (days <= (input.expiringSoonDays ?? getExpiringSoonDays())) return "EXPIRING_SOON";
  }
  if (input.dueAt) {
    const days = calendarDayDifference(input.evaluatedAt, input.dueAt, input.timeZone);
    if (days < 0) return "OVERDUE";
    if (days === 0) return "DUE";
  }
  return "CURRENT";
}
