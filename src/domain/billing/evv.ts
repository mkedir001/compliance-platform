/**
 * Visit billing rollups with EVV (electronic visit verification) separation.
 *
 * A visit is billable only when it is EVV compliant. Non-compliant visits are kept and listed with the reasons,
 * but are never counted in billable hours or dollars. The compliance rule below is a configurable operational
 * check against the data AxisCare exposes (clock times, method, GPS or telephony location). It is not a
 * certification that a visit satisfies a payer's EVV requirements.
 *
 * All money is whole cents and all durations are whole minutes, so totals never drift.
 */
export type VisitLocation = { latitude?: string | null; longitude?: string | null; streetAddress1?: string | null; city?: string | null; telephonyPhone?: string | null } | null;
export type ClockEvent = { time: string | null; method?: string | null; location?: VisitLocation; coordinates?: { latitude: string; longitude: string } | null; telephonyPhone?: string | null } | null;

export type BillingVisit = {
  id: string;
  clientId: string;
  caregiverName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clockIn: ClockEvent;
  clockOut: ClockEvent;
  service: { code: string | null; description: string | null; procedureCode?: string | null } | null;
  /** Dollars per hour in cents. */
  hourlyRateCents: number;
  /** AxisCare "verified" flag. It is shown, but it is not the EVV decision. */
  verified?: boolean;
  modificationReason?: string | null;
  /** Set once the visit has been included in a billing run. */
  billedRunId?: string | null;
};

export type EvvIssue = "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT" | "CLOCK_OUT_BEFORE_CLOCK_IN" | "NO_CLOCK_IN_LOCATION" | "NO_CLOCK_OUT_LOCATION" | "NO_SERVICE_CODE";

export const EVV_ISSUE_LABELS: Record<EvvIssue, string> = {
  MISSING_CLOCK_IN: "No clock-in time recorded",
  MISSING_CLOCK_OUT: "No clock-out time recorded",
  CLOCK_OUT_BEFORE_CLOCK_IN: "Clock-out is not after clock-in",
  NO_CLOCK_IN_LOCATION: "No GPS or phone location at clock-in",
  NO_CLOCK_OUT_LOCATION: "No GPS or phone location at clock-out",
  NO_SERVICE_CODE: "No service type recorded",
};

const validTime = (value: string | null | undefined) => (value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).getTime() : null);

function hasLocation(event: NonNullable<ClockEvent>) {
  const coordinates = event.coordinates ?? (event.location?.latitude && event.location?.longitude ? { latitude: event.location.latitude, longitude: event.location.longitude } : null);
  return Boolean(coordinates?.latitude && coordinates?.longitude) || Boolean(event.telephonyPhone) || Boolean(event.location?.telephonyPhone);
}

export function evvIssues(visit: BillingVisit): EvvIssue[] {
  const issues: EvvIssue[] = [];
  const start = validTime(visit.clockIn?.time), end = validTime(visit.clockOut?.time);
  if (start === null) issues.push("MISSING_CLOCK_IN");
  if (end === null) issues.push("MISSING_CLOCK_OUT");
  if (start !== null && end !== null && end <= start) issues.push("CLOCK_OUT_BEFORE_CLOCK_IN");
  if (visit.clockIn && start !== null && !hasLocation(visit.clockIn)) issues.push("NO_CLOCK_IN_LOCATION");
  if (visit.clockOut && end !== null && !hasLocation(visit.clockOut)) issues.push("NO_CLOCK_OUT_LOCATION");
  if (!visit.service?.code) issues.push("NO_SERVICE_CODE");
  return issues;
}

/** Worked minutes between clock-in and clock-out, or 0 when the visit has no complete, ordered pair. */
export function workedMinutes(visit: BillingVisit) {
  const start = validTime(visit.clockIn?.time), end = validTime(visit.clockOut?.time);
  return start !== null && end !== null && end > start ? Math.round((end - start) / 60000) : 0;
}

export const amountCents = (minutes: number, hourlyRateCents: number) => Math.round((minutes * hourlyRateCents) / 60);

export type ClassifiedVisit = BillingVisit & { minutes: number; amountCents: number; issues: EvvIssue[]; evvCompliant: boolean; billed: boolean };

export function classifyVisit(visit: BillingVisit): ClassifiedVisit {
  const issues = evvIssues(visit), minutes = workedMinutes(visit);
  return { ...visit, minutes, amountCents: amountCents(minutes, visit.hourlyRateCents), issues, evvCompliant: issues.length === 0, billed: Boolean(visit.billedRunId) };
}

export type BillingRun = { id: string; clientId: string; billedAt: string; hours: number; amountCents: number };

export type ClientBillingSummary = {
  clientId: string;
  /** Every completed visit, compliant or not. */
  totalMinutes: number;
  evvMinutes: number;
  nonEvvMinutes: number;
  /** Compliant hours not yet billed: the "since last billing" figure. */
  unbilledEvvMinutes: number;
  unbilledNonEvvMinutes: number;
  billedMinutes: number;
  billedCents: number;
  unbilledEvvCents: number;
  /** Money that will not be billed because the visits are not EVV compliant. */
  unbilledNonEvvCents: number;
  nonEvvVisitCount: number;
  visitCount: number;
  firstVisitAt: string | null;
  lastBilledAt: string | null;
  runCount: number;
  /** Hourly rate of the most recent visit, used to price approved hours. Null until there is a visit. */
  latestRateCents: number | null;
};

export function summarizeClient(clientId: string, visits: readonly BillingVisit[], runs: readonly BillingRun[]): ClientBillingSummary {
  const summary: ClientBillingSummary = {
    clientId, totalMinutes: 0, evvMinutes: 0, nonEvvMinutes: 0, unbilledEvvMinutes: 0, unbilledNonEvvMinutes: 0, billedMinutes: 0, billedCents: 0,
    unbilledEvvCents: 0, unbilledNonEvvCents: 0, nonEvvVisitCount: 0, visitCount: 0, firstVisitAt: null, lastBilledAt: null, runCount: 0, latestRateCents: null,
  };
  let latestRateAt = "";
  for (const raw of visits) {
    if (raw.clientId !== clientId) continue;
    const visit = classifyVisit(raw);
    if (!visit.minutes) continue; // in progress or unusable: not countable yet
    summary.visitCount++;
    summary.totalMinutes += visit.minutes;
    const when = visit.clockIn?.time ?? null;
    if (when && (!summary.firstVisitAt || when < summary.firstVisitAt)) summary.firstVisitAt = when;
    if (when && when >= latestRateAt) { latestRateAt = when; summary.latestRateCents = visit.hourlyRateCents; }
    if (visit.evvCompliant) {
      summary.evvMinutes += visit.minutes;
      if (visit.billed) { summary.billedMinutes += visit.minutes; summary.billedCents += visit.amountCents; }
      else { summary.unbilledEvvMinutes += visit.minutes; summary.unbilledEvvCents += visit.amountCents; }
    } else {
      summary.nonEvvMinutes += visit.minutes;
      summary.nonEvvVisitCount++;
      if (!visit.billed) { summary.unbilledNonEvvMinutes += visit.minutes; summary.unbilledNonEvvCents += visit.amountCents; }
    }
  }
  for (const run of runs) {
    if (run.clientId !== clientId) continue;
    summary.runCount++;
    if (!summary.lastBilledAt || run.billedAt > summary.lastBilledAt) summary.lastBilledAt = run.billedAt;
  }
  return summary;
}

/** Visits a bill-now action would include: compliant, completed, and not already billed. */
export function billableVisits(clientId: string, visits: readonly BillingVisit[]) {
  return visits.map(classifyVisit).filter(visit => visit.clientId === clientId && visit.evvCompliant && visit.minutes > 0 && !visit.billed);
}

/** Visits that are excluded from billing, with the reasons, newest first. */
export function nonCompliantVisits(clientId: string, visits: readonly BillingVisit[]) {
  return visits.map(classifyVisit)
    .filter(visit => visit.clientId === clientId && !visit.evvCompliant && !visit.billed && (visit.clockIn?.time || visit.scheduledStart))
    .sort((a, b) => (b.clockIn?.time ?? b.scheduledStart ?? "").localeCompare(a.clockIn?.time ?? a.scheduledStart ?? ""));
}

export const formatHours = (minutes: number) => `${(minutes / 60).toFixed(2)} h`;
export const formatHoursWithAmount = (minutes: number, cents: number | null) => `${formatHours(minutes)} (${cents === null ? "—" : formatMoney(cents)})`;
export const formatMoney = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** One client billed on its own, or several clients billed together in one batch (a chosen group, or everyone). */
export type BillingMode = "INDIVIDUAL" | "GROUP";
export type BillingPlan = {
  mode: BillingMode;
  lines: Array<{ clientId: string; visitIds: string[]; minutes: number; amountCents: number }>;
  totalMinutes: number;
  totalCents: number;
  /** Selected clients that have nothing billable, so the reviewer sees why they were left out. */
  skipped: string[];
};

/**
 * Plans a billing action. "Bill individually" gives each client its own invoice; a group is one combined batch.
 * Either way the same visits are included, so the totals match; only the grouping of invoices differs.
 */
export function planBilling(clientIds: readonly string[], visits: readonly BillingVisit[], mode: BillingMode): BillingPlan {
  const lines: BillingPlan["lines"] = [], skipped: string[] = [];
  for (const clientId of [...new Set(clientIds)]) {
    const included = billableVisits(clientId, visits);
    if (!included.length) { skipped.push(clientId); continue; }
    lines.push({ clientId, visitIds: included.map(visit => visit.id), minutes: included.reduce((sum, visit) => sum + visit.minutes, 0), amountCents: included.reduce((sum, visit) => sum + visit.amountCents, 0) });
  }
  return { mode, lines, totalMinutes: lines.reduce((sum, line) => sum + line.minutes, 0), totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0), skipped };
}

/** Marks the planned visits as billed under a new run per invoice. Pure, so callers can persist or preview it. */
export function applyBillingPlan(visits: readonly BillingVisit[], plan: BillingPlan, billedAt: string, runId: (index: number) => string) {
  const runs: BillingRun[] = [], billedBy = new Map<string, string>();
  const groups = plan.mode === "GROUP" ? [plan.lines] : plan.lines.map(line => [line]);
  groups.forEach((group, index) => {
    const id = runId(index);
    for (const line of group) {
      for (const visitId of line.visitIds) billedBy.set(visitId, id);
      runs.push({ id, clientId: line.clientId, billedAt, hours: line.minutes / 60, amountCents: line.amountCents });
    }
  });
  return { visits: visits.map(visit => (billedBy.has(visit.id) ? { ...visit, billedRunId: billedBy.get(visit.id)! } : visit)), runs };
}
