import { describe, expect, it } from "vitest";
import { classifyEvv, roundMoneyCents, type EvvVisitInput } from "@/domain/billing/evv";

const good: EvvVisitInput = { clockInAt: new Date("2026-10-01T14:00:00Z"), clockOutAt: new Date("2026-10-01T16:30:00Z"), clockInLatitude: 43.03, clockInLongitude: -93.1, clockOutLatitude: 43.03, clockOutLongitude: -93.1, clockInPhone: null, clockOutPhone: null, serviceCode: "HOMEMAKING", removed: false };

describe("EVV classification", () => {
  it("accepts a complete visit and computes hours", () => { expect(classifyEvv(good)).toEqual({ compliant: true, reasons: [], hours: 2.5 }); });
  it("accepts phone verification as the location", () => { expect(classifyEvv({ ...good, clockInLatitude: null, clockInLongitude: null, clockInPhone: "6125550100" }).compliant).toBe(true); });
  it("flags missing clock-out and gives no hours", () => { expect(classifyEvv({ ...good, clockOutAt: null })).toMatchObject({ compliant: false, reasons: ["MISSING_CLOCK_OUT"], hours: null }); });
  it("flags clock-out before clock-in", () => { expect(classifyEvv({ ...good, clockOutAt: new Date("2026-10-01T13:00:00Z") })).toMatchObject({ compliant: false, reasons: ["CLOCK_OUT_BEFORE_IN"], hours: null }); });
  it("needs a location at both ends", () => { expect(classifyEvv({ ...good, clockOutLatitude: null, clockOutLongitude: null }).reasons).toEqual(["MISSING_CLOCK_OUT_LOCATION"]); expect(classifyEvv({ ...good, clockInLatitude: 43, clockInLongitude: null }).reasons).toEqual(["MISSING_CLOCK_IN_LOCATION"]); });
  it("needs a service type and reports every problem", () => { expect(classifyEvv({ ...good, serviceCode: null, clockInAt: null }).reasons).toEqual(["MISSING_CLOCK_IN", "MISSING_SERVICE"]); });
  it("accepts Prisma decimal-like coordinates", () => { expect(classifyEvv({ ...good, clockInLatitude: { toString: () => "43.03" } as unknown, clockInLongitude: "-93.1" }).compliant).toBe(true); });
  it("rounds money to whole cents", () => { expect(roundMoneyCents(2.5, 2550)).toBe(6375); expect(roundMoneyCents(0.33, 2550)).toBe(842); });
});
