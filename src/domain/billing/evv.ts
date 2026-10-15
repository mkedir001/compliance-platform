// EVV rule used by Waldah (confirmed by the program director): clock-in and clock-out present and in order,
// a location (GPS or phone) at BOTH ends, and a service type. AxisCare's own "verified" flag is NOT EVV.
export type EvvVisitInput = {
  clockInAt: Date | null; clockOutAt: Date | null;
  clockInLatitude: unknown; clockInLongitude: unknown; clockOutLatitude: unknown; clockOutLongitude: unknown;
  clockInPhone: string | null; clockOutPhone: string | null; serviceCode: string | null; removed: boolean;
};
export type EvvReason = "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT" | "CLOCK_OUT_BEFORE_IN" | "MISSING_CLOCK_IN_LOCATION" | "MISSING_CLOCK_OUT_LOCATION" | "MISSING_SERVICE";
export const EVV_REASON_LABELS: Record<EvvReason, string> = {
  MISSING_CLOCK_IN: "No clock-in time", MISSING_CLOCK_OUT: "No clock-out time", CLOCK_OUT_BEFORE_IN: "Clock-out is before clock-in",
  MISSING_CLOCK_IN_LOCATION: "No location at clock-in", MISSING_CLOCK_OUT_LOCATION: "No location at clock-out", MISSING_SERVICE: "No service type"
};
const hasPoint = (lat: unknown, lon: unknown) => lat !== null && lat !== undefined && lon !== null && lon !== undefined && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

export function classifyEvv(v: EvvVisitInput): { compliant: boolean; reasons: EvvReason[]; hours: number | null } {
  const reasons: EvvReason[] = [];
  if (!v.clockInAt) reasons.push("MISSING_CLOCK_IN");
  if (!v.clockOutAt) reasons.push("MISSING_CLOCK_OUT");
  if (v.clockInAt && v.clockOutAt && v.clockOutAt <= v.clockInAt) reasons.push("CLOCK_OUT_BEFORE_IN");
  if (!hasPoint(v.clockInLatitude, v.clockInLongitude) && !v.clockInPhone) reasons.push("MISSING_CLOCK_IN_LOCATION");
  if (!hasPoint(v.clockOutLatitude, v.clockOutLongitude) && !v.clockOutPhone) reasons.push("MISSING_CLOCK_OUT_LOCATION");
  if (!v.serviceCode) reasons.push("MISSING_SERVICE");
  const ordered = v.clockInAt && v.clockOutAt && v.clockOutAt > v.clockInAt;
  const hours = ordered ? Math.round(((v.clockOutAt!.getTime() - v.clockInAt!.getTime()) / 3_600_000) * 100) / 100 : null;
  return { compliant: reasons.length === 0, reasons, hours };
}

export function roundMoneyCents(hours: number, rateCents: number) { return Math.round(hours * rateCents); }
