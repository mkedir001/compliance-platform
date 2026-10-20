import { createHash } from "node:crypto";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const date = (v: unknown) => { const s = str(v); if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };
const num = (v: unknown) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : null; };
const id = (v: unknown) => typeof v === "number" || typeof v === "string" ? String(v) : null;

export function hashPayload(payload: unknown) { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }

/** Dollars (25.5) to whole cents, rounding half up; null when AxisCare gave no rate. */
export function dollarsToCents(value: unknown) { const n = num(value); return n === null ? null : Math.round(n * 100 + Number.EPSILON); }

export function mapVisit(raw: Json) {
  const clockIn = obj(raw.clockIn), clockOut = obj(raw.clockOut), client = obj(raw.client), caregiver = obj(raw.caregiver), service = obj(raw.service), reason = obj(raw.modificationReason);
  const coord = (c: Json | null, key: string) => num(obj(c?.coordinates)?.[key]);
  return {
    externalId: id(raw.id),
    axisCareClientId: id(client?.id), axisCareCaregiverId: id(caregiver?.id),
    startAt: date(raw.startDate), endAt: date(raw.endDate), scheduledStartAt: date(raw.scheduledStartDate), scheduledEndAt: date(raw.scheduledEndDate),
    clockInAt: date(clockIn?.time), clockOutAt: date(clockOut?.time), clockInMethod: str(clockIn?.method), clockOutMethod: str(clockOut?.method),
    clockInLatitude: coord(clockIn, "latitude"), clockInLongitude: coord(clockIn, "longitude"), clockOutLatitude: coord(clockOut, "latitude"), clockOutLongitude: coord(clockOut, "longitude"),
    clockInPhone: str(clockIn?.telephonyPhone), clockOutPhone: str(clockOut?.telephonyPhone),
    serviceCode: str(service?.code), procedureCode: str(service?.procedureCode), visitType: str(raw.type), timezone: str(raw.timezone),
    verified: raw.verified === true, removed: raw.removed === true,
    chargeRateCents: dollarsToCents(raw.chargeRate), billableRateMode: str(raw.billableRateMode), modificationReason: str(reason?.name)
  };
}

export function mapClientIdentity(raw: Json) {
  return {
    externalId: id(raw.id), firstName: str(raw.firstName), lastName: str(raw.lastName), goesBy: str(raw.goesBy),
    dateOfBirth: str(raw.dateOfBirth), startDate: str(raw.startDate), medicaidNumber: str(raw.medicaidNumber), active: obj(raw.status)?.active === true
  };
}

export type AxisCareClientLifecycle = "ACTIVE" | "INACTIVE" | "DISCHARGED" | "ARCHIVED" | "UNKNOWN";

/**
 * AxisCare documents client status as an agency-configured label plus an
 * authoritative active boolean. Preserve the label and only promote the two
 * historical categories when the source label says so explicitly.
 */
export function mapClientLifecycle(raw: Json): { lifecycle: AxisCareClientLifecycle; sourceLabel: string | null; active: boolean | null } {
  const status = obj(raw.status);
  const active = typeof status?.active === "boolean" ? status.active : null;
  const sourceLabel = str(status?.label) ?? (typeof raw.status === "string" ? str(raw.status) : null);
  if (active === true) return { lifecycle: "ACTIVE", sourceLabel, active };
  if (active === false) {
    const label = sourceLabel?.toLowerCase() ?? "";
    if (label.includes("discharg")) return { lifecycle: "DISCHARGED", sourceLabel, active };
    if (label.includes("archiv")) return { lifecycle: "ARCHIVED", sourceLabel, active };
    return { lifecycle: "INACTIVE", sourceLabel, active };
  }
  return { lifecycle: "UNKNOWN", sourceLabel, active };
}

export function monthsAgo(months: number, now = new Date()) { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - months); return d; }
