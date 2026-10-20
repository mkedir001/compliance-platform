export type BillingClient = {
  id: string;
  name: string;
  status: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  approvedHours: number | null;
  axisCareLinked: boolean;
  /** Shown under the client name. Only sent to billing.run (null for view-only roles). */
  axisCareClientId: string | null;
};
/** Outcome of a billing attempt for one visit. Nothing produces these yet: the billing ledger will.
 *  Error code/message/guidance and success details are placeholders until their content is designed. */
export type BillingResult =
  | { status: "BILLED"; amountCents: number; reference: string | null; at: string; startedBy: string | null }
  | { status: "ERROR"; code: string; message: string; guidance: string | null; attemptedCents: number | null; reference: string | null; at: string; startedBy: string | null };
export type BillingVisitRow = {
  id: string; clientId: string; startAt: string | null; clockInAt: string | null; clockOutAt: string | null; serviceCode: string | null;
  hours: number | null; rateCents: number | null; amountCents: number | null; compliant: boolean; reasons: string[];
  waldahServiceType: string | null;
  caregiverName: string | null;
  /** null = not billed yet (also the case for failed attempts that produced no result record). */
  result: BillingResult | null;
};
export type PendingMatch = { axisCareClientId: string; axisCareName: string; axisCareDateOfBirth: string | null; axisCareLifecycle:"ACTIVE"|"INACTIVE"|"DISCHARGED"|"ARCHIVED"|"UNKNOWN"; axisCareStatusLabel:string|null; state: "SUGGESTED"|"AMBIGUOUS"|"UNMATCHED"|"CONFIRMED"|"IGNORED"; confirmedClientName:string|null; candidates:{id:string;clientId:string;clientName:string;clientDateOfBirth:string|null;reason:string;score:number}[]; availableClients:{id:string;name:string;dateOfBirth:string|null}[] };
export type AxisCareConnectionView = { configured: boolean; baseUrl: string | null; status: string; lastTestedAt: string | null; lastConnectedAt: string | null; lastErrorCode: string | null; historyMonths: number };
export type AxisCareAdministration = {
  connection: AxisCareConnectionView;
  caregivers: { externalId: string; firstName: string | null; lastName: string | null; employeeId: string | null }[];
  employees: { id: string; firstName: string; lastName: string; employeeNumber: string | null; axisCareCaregiverId: string | null }[];
  services: { axisCareServiceCode: string; axisCareServiceId: string | null; description: string | null; procedureCode: string | null; visitCount: number; waldahServiceType: string | null }[];
  serviceTargets: { value: string; label: string }[];
  syncStates: { entity: string; lastSuccessAt: string | null; lastError: string | null; lastCount: number }[];
  webhook: { enabled: false; reason: string };
};

export const REASON_LABELS: Record<string, string> = {
  MISSING_CLOCK_IN: "No clock-in time", MISSING_CLOCK_OUT: "No clock-out time", CLOCK_OUT_BEFORE_IN: "Clock-out is before clock-in",
  MISSING_CLOCK_IN_LOCATION: "No location at clock-in", MISSING_CLOCK_OUT_LOCATION: "No location at clock-out", MISSING_SERVICE: "No service type"
};
export const money = (cents: number | null) => cents === null ? "No rate" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
export const stamp = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—";

export const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
export const day = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
  : "Not recorded";

/** Snapshot figures for a client row or detail header. Visits already billed (result.status === "BILLED") are left out, so "ready to bill" means not yet submitted. */
export function summarizeVisits(allVisits: (Pick<BillingVisitRow, "compliant" | "hours" | "amountCents" | "rateCents"> & { result?: BillingResult | null })[]) {
  const visits = allVisits.filter(visit => visit.result?.status !== "BILLED");
  const evv = visits.filter(visit => visit.compliant), nonEvv = visits.filter(visit => !visit.compliant);
  const sum = (rows: typeof visits) => ({ hours: rows.reduce((total, visit) => total + (visit.hours ?? 0), 0), cents: rows.reduce((total, visit) => total + (visit.amountCents ?? 0), 0), unrated: rows.some(visit => visit.hours !== null && visit.rateCents === null) });
  const all = sum(visits);
  return { evvCount: evv.length, nonEvvCount: nonEvv.length, readyHours: all.hours, readyCents: all.cents, unrated: all.unrated, evv: sum(evv), nonEvv: sum(nonEvv) };
}
export const hoursWithAmount = (hoursValue: number, cents: number, unrated = false) => `${hoursValue.toFixed(2)} h (${money(cents)}${unrated ? "+" : ""})`;

export const isBilled = (visit: Pick<BillingVisitRow, "result">) => visit.result?.status === "BILLED";
export const resultLabel = (result: BillingResult | null, formatMoney: (cents: number | null) => string) => !result ? "Not billed" : result.status === "BILLED" ? `Billed · ${formatMoney(result.amountCents)}` : `Error · ${result.code}`;
