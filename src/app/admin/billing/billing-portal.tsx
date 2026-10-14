"use client";
/**
 * BILLING SCREEN: UX TEMPLATE, NOT YET WIRED TO LIVE DATA.
 *
 * Read this before changing anything. Every data item below is marked `WIRING:` with its intended live source.
 * Search the file (and src/domain/billing/*, src/app/admin/billing/page.tsx) for "WIRING:" to find every seam.
 *
 * Overall plan for the live version:
 *   1. AxisCare webhooks (POST to a Waldah endpoint, header x-webhook-id) announce visit changes:
 *      scheduling.visit.clockedIn / clockedOut / clockIn.location / clockOut.location / call.clockIn / call.clockOut /
 *      created / moved / startTime / endTime / caregiver / remove / verify. The payload is thin (event + entity id),
 *      so the handler re-fetches the full visit with GET https://10461.axiscare.com/api/visits?visitIds=<id>
 *      (Bearer token, header X-AxisCare-Api-Version: 2023-10-01) and upserts it into a visits table.
 *   2. A slow safety-net poll of GET /api/visits?updatedSinceDate=<last run> catches events that failed all 3 webhook retries.
 *   3. Visits and billing runs are stored in Waldah's database; this screen reads them through an API route
 *      (for example GET /api/organizations/{organizationId}/billing/summary) instead of using sample data.
 *   4. The dollar calculation supplied by the business replaces the placeholder in src/domain/billing/evv.ts (amountCents).
 *
 * Until then the `visits` and `runs` state below is empty (or filled with clearly labelled sample data by the
 * "Preview with sample data" button), and the confirm buttons only change this page.
 */
import "./billing.css";
import { useMemo, useState } from "react";
import { Drawer, StatusChip } from "@/app/components/portal-ui";
import {
  EVV_ISSUE_LABELS, applyBillingPlan, billableVisits, formatHours, formatHoursWithAmount, formatMoney, nonCompliantVisits, planBilling, summarizeClient,
  type BillingMode, type BillingRun, type BillingVisit, type ClientBillingSummary,
} from "@/domain/billing/evv";
import { sampleBillingData } from "@/domain/billing/sample";

/**
 * One row per Waldah client.
 * WIRING: id, name, status come from the Waldah `Client` table (see page.tsx). serviceStart / serviceEnd /
 * approvedHours come from the client's `ClientService` rows (authorizationStart, authorizationEnd, authorizedHours).
 * To map a client to AxisCare, a stored AxisCare client id is needed (AxisCare visit.client.id / client.externalId);
 * that mapping does not exist yet and must be added when the visits table is created.
 */
export type BillingClient = { id: string; name: string; status: string; serviceStart: string | null; serviceEnd: string | null; approvedHours: number | null };

const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const day = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)) : "—");
const clock = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—");

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "warning" }) {
  return <p className={`billing-stat${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</p>;
}

/**
 * Approved hours for the service period, priced at the client's current rate.
 * WIRING: hours = BillingClient.approvedHours (Waldah ClientService.authorizedHours, summed). The dollar figure uses
 * a PLACEHOLDER rate (the latest visit's hourly rate). Replace with the business's rate calculation when provided.
 */
const approvedMinutes = (client: BillingClient) => (client.approvedHours === null ? null : Math.round(client.approvedHours * 60));
const approvedCents = (client: BillingClient, summary: ClientBillingSummary) => (client.approvedHours === null || summary.latestRateCents === null ? null : Math.round(client.approvedHours * summary.latestRateCents));

/** One "hours (dollars)" figure on a card. Hours first, dollars in brackets, as the business requires. */
function Figure({ label, minutes, cents }: { label: string; minutes: number | null; cents: number | null }) {
  return <span><small>{label}</small><b>{minutes === null ? "Not recorded" : formatHours(minutes)}</b><em>{minutes === null ? "" : `(${cents === null ? "—" : formatMoney(cents)})`}</em></span>;
}

function ClientCard({ client, summary, selected, onSelect, onOpen }: { client: BillingClient; summary: ClientBillingSummary; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <article className={`billing-card${selected ? " selected" : ""}`}>
      {/* UI-only selection for group billing. Nothing is stored. The selected client ids become the group passed to the billing action. */}
      <label className="billing-card-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${client.name} for group billing`} /></label>
      <button type="button" className="billing-card-open" onClick={onOpen} aria-label={`Open billing for ${client.name}`}>
        <span className="billing-card-head"><strong>{client.name}</strong><StatusChip tone={client.status === "ACTIVE" ? "good" : "neutral"}>{pretty(client.status)}</StatusChip></span>
        {/* WIRING (the three figures): all come from ClientBillingSummary, which is computed from the visits and billing-run
            tables, never typed in. Hours in brackets show dollars; the dollar calculation is a placeholder for now.
            - Total approved hours: the client's authorization for the service period (usually one year). Source: Waldah ClientService.authorizedHours.
            - Billed since start of service: EVV-compliant hours already billed since the start of the service year. Source: visits whose billedRunId is set (billing runs table).
            - Since last billing: EVV-compliant hours not yet billed, i.e. what the next billing will cover. Source: visits with no billedRunId. */}
        <span className="billing-card-grid">
          <Figure label="Total approved hours" minutes={approvedMinutes(client)} cents={approvedCents(client, summary)} />
          <Figure label="Billed since start of service" minutes={summary.billedMinutes} cents={summary.billedCents} />
          <Figure label="Since last billing" minutes={summary.unbilledEvvMinutes} cents={summary.unbilledEvvCents} />
        </span>
        {/* WIRING: count of this client's visits that fail the EVV check (see evvIssues in src/domain/billing/evv.ts). These visits are never billed. */}
        <span className="billing-card-foot">
          {summary.nonEvvVisitCount ? <StatusChip tone="warning">{summary.nonEvvVisitCount} non-EVV visits, not billable</StatusChip> : <span className="billing-muted">All visits EVV compliant</span>}
        </span>
      </button>
    </article>
  );
}

/**
 * Visit rows. WIRING: each row is one AxisCare visit (GET /api/visits). Field mapping:
 *   Visit id           visit.id (format "s=1:d=2023-10-01", not a plain number); date from clockIn.time or scheduledStartDate
 *   Caregiver          visit.caregiver.firstName + lastName
 *   Service            visit.service.description; small text: service.code and service.procedureCode
 *   Clock in / out     visit.clockIn.time / visit.clockOut.time; small text: .method ("Mobile", "Web", telephony)
 *   Hours              clockOut.time minus clockIn.time (placeholder calculation)
 *   Rate               hourly rate for the service. NOT in the visit payload shown in AxisCare's docs; its source is still to be decided (provided calculation).
 *   Amount             hours times rate (placeholder calculation)
 *   Why it is excluded the reasons returned by evvIssues(); plus visit.modificationReason.name shown as "AxisCare note"
 */
function VisitTable({ visits, showReasons }: { visits: ReturnType<typeof billableVisits>; showReasons?: boolean }) {
  if (!visits.length) return <p className="billing-empty">{showReasons ? "No non-compliant visits." : "No billable visits waiting."}</p>;
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead><tr><th>Visit</th><th>Caregiver</th><th>Service</th><th>Clock in</th><th>Clock out</th><th>Hours</th><th>Rate</th><th>{showReasons ? "Why it is excluded" : "Amount"}</th></tr></thead>
        <tbody>
          {visits.map(visit => (
            <tr key={visit.id}>
              <td data-label="Visit">{day(visit.clockIn?.time ?? visit.scheduledStart)}<small>{visit.id}</small></td>
              <td data-label="Caregiver">{visit.caregiverName}</td>
              <td data-label="Service">{visit.service?.description ?? "—"}<small>{[visit.service?.code, visit.service?.procedureCode].filter(Boolean).join(" · ")}</small></td>
              <td data-label="Clock in">{clock(visit.clockIn?.time)}<small>{visit.clockIn?.method ?? ""}</small></td>
              <td data-label="Clock out">{clock(visit.clockOut?.time)}<small>{visit.clockOut?.method ?? ""}</small></td>
              <td data-label="Hours">{visit.minutes ? formatHours(visit.minutes) : "—"}</td>
              <td data-label="Rate">{formatMoney(visit.hourlyRateCents)}/h</td>
              <td data-label={showReasons ? "Why it is excluded" : "Amount"}>
                {showReasons
                  ? <ul className="billing-reasons">{visit.issues.map(issue => <li key={issue}>{EVV_ISSUE_LABELS[issue]}</li>)}{visit.modificationReason ? <li className="billing-muted">AxisCare note: {visit.modificationReason}</li> : null}</ul>
                  : formatMoney(visit.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BillingPortal({ clients }: { clients: BillingClient[] }) {
  const [preview, setPreview] = useState(false);
  // WIRING: `visits` should come from the database table filled by the AxisCare webhooks and visits API (see the plan at the top of this file).
  // Load it with an API route and pass it in as a prop (or fetch it here) instead of starting empty.
  const [visits, setVisits] = useState<BillingVisit[]>([]);
  // WIRING: `runs` is the billing history: one record per billing run, written when the user confirms a billing.
  // Needs a billing-runs table (id, clientId, billedAt, hours, amountCents) and each billed visit stores its run id.
  const [runs, setRuns] = useState<BillingRun[]>([]);
  const [search, setSearch] = useState("");
  const [onlyBillable, setOnlyBillable] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<{ ids: string[]; mode: BillingMode; all?: boolean } | null>(null);
  const [notice, setNotice] = useState("");

  // WIRING: summarizeClient (src/domain/billing/evv.ts) is the only place hours and dollars are totalled. For the live version
  // this can stay client-side over the loaded visits, or move to the server so the API returns ready-made summaries.
  const summaries = useMemo(() => new Map(clients.map(client => [client.id, summarizeClient(client.id, visits, runs)])), [clients, visits, runs]);
  const shown = clients.filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase()) && (!onlyBillable || (summaries.get(client.id)?.unbilledEvvCents ?? 0) > 0));
  const totals = [...summaries.values()].reduce((sum, item) => ({ billable: sum.billable + item.unbilledEvvCents, excluded: sum.excluded + item.unbilledNonEvvCents, billed: sum.billed + item.billedCents, hours: sum.hours + item.unbilledEvvMinutes, excludedMinutes: sum.excludedMinutes + item.unbilledNonEvvMinutes, billedMinutes: sum.billedMinutes + item.billedMinutes }), { billable: 0, excluded: 0, billed: 0, hours: 0, excludedMinutes: 0, billedMinutes: 0 });
  const open = openId ? clients.find(client => client.id === openId) ?? null : null;
  const billableIds = clients.filter(client => (summaries.get(client.id)?.unbilledEvvCents ?? 0) > 0).map(client => client.id);
  const plan = review ? planBilling(review.ids, visits, review.mode) : null;
  const nameOf = (id: string) => clients.find(client => client.id === id)?.name ?? id;

  // PREVIEW ONLY: swaps in made-up sample visits so the layout can be reviewed. Remove this button and src/domain/billing/sample.ts
  // when the live data is connected.
  function togglePreview() {
    setNotice("");
    if (preview) { setPreview(false); setVisits([]); setRuns([]); return; }
    const sample = sampleBillingData(clients.map(client => client.id));
    setVisits(sample.visits); setRuns(sample.runs); setPreview(true);
  }
  // WIRING: this is where a real billing is submitted. In the live version, POST the plan (client ids and visit ids from `plan.lines`)
  // to a server route such as POST /api/organizations/{organizationId}/billing/runs. That route must, in one database transaction,
  // re-check each visit is still EVV compliant and unbilled, create the billing run(s), set billedRunId on those visits, and write an audit entry.
  // The preview below only changes local state and sends nothing.
  function confirm() {
    if (!review || !plan || !preview) return;
    const now = new Date().toISOString(), stamp = Date.now();
    const applied = applyBillingPlan(visits, plan, now, index => `preview-${stamp}-${index}`);
    setVisits(applied.visits); setRuns(current => [...current, ...applied.runs]);
    setNotice(`Preview only: ${plan.lines.length} ${plan.lines.length === 1 ? "client" : "clients"} marked as billed for ${formatMoney(plan.totalCents)}. Nothing was sent anywhere.`);
    setSelected([]); setReview(null);
  }
  const toggle = (id: string) => setSelected(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));

  return (
    <main className="admin-shell billing-shell" aria-label="Organization billing workspace">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Billing</h1>
          <p className="lede">Hours and dollars by client, with EVV-compliant visits kept separate from visits that cannot be billed.</p>
        </div>
      </header>

      {/* Status banner. WIRING: show the "not connected" version until the AxisCare feed is live, then replace it with the last-sync time
          (for example the time of the latest webhook or poll) and any sync error. */}
      {!preview ? (
        <section className="billing-banner" role="status">
          <div><strong>Visit data is not connected yet.</strong><p>Clock-in and clock-out records will come from AxisCare once the connection is set up. Until then every client shows zero. You can look at the screen with sample data.</p></div>
          <button type="button" className="secondary" onClick={togglePreview}>Preview with sample data</button>
        </section>
      ) : (
        <section className="billing-banner sample" role="status">
          <div><strong>Sample data.</strong><p>These visits and amounts are made up to show the layout. Billing actions here change nothing outside this page.</p></div>
          <button type="button" className="secondary" onClick={togglePreview}>Exit preview</button>
        </section>
      )}
      {notice ? <p className="action-feedback success" role="status">{notice}</p> : null}

      {!open ? (
        <>
          {/* WIRING: totals across all clients, summed from the same per-client summaries. Billable now = EVV compliant and unbilled;
              Not billable = visits that fail EVV; Billed to date = visits already in a billing run. Hours first, dollars in brackets. */}
          <section className="billing-stats" aria-label="Billing totals">
            <Stat label="Billable now (EVV compliant)" value={formatHoursWithAmount(totals.hours, totals.billable)} note="EVV compliant, not yet billed" tone="good" />
            <Stat label="Not billable (non-EVV)" value={formatHoursWithAmount(totals.excludedMinutes, totals.excluded)} note="Excluded until fixed" tone="warning" />
            <Stat label="Billed to date" value={formatHoursWithAmount(totals.billedMinutes, totals.billed)} />
            <Stat label="Clients" value={String(clients.length)} note={`${billableIds.length} with billable visits`} />
          </section>

          {/* Billing actions.
              - Bill group: bills the ticked clients together in one batch (needs at least 2). WIRING: one billing run covering the selected clients.
              - Bill all: bills every client who has billable (EVV compliant, unbilled) hours, as one batch.
              - Billing one client on its own: the "Bill now" button on that client's detail page.
              All three open the review drawer first; nothing is billed until the user confirms there. */}
          <section className="billing-toolbar" aria-label="Billing actions">
            <label className="billing-search">Search clients<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name" /></label>
            <label className="billing-check"><input type="checkbox" checked={onlyBillable} onChange={event => setOnlyBillable(event.target.checked)} /> Only clients with billable visits</label>
            <div className="billing-actions">
              <button type="button" className="secondary" disabled={selected.length < 2} onClick={() => setReview({ ids: selected, mode: "GROUP" })}>Bill group ({selected.length} selected)</button>
              <button type="button" disabled={!billableIds.length} onClick={() => setReview({ ids: billableIds, mode: billableIds.length > 1 ? "GROUP" : "INDIVIDUAL", all: true })}>Bill all ({billableIds.length})</button>
            </div>
          </section>
          <p className="billing-hint">Tick the box on each card to choose a group of clients to bill together. Open a card to bill one client on its own or see visit detail.</p>

          {clients.length === 0 ? <p className="billing-empty">There are no clients yet.</p>
            : shown.length === 0 ? <p className="billing-empty">No clients match.</p>
            : <section className="billing-grid" aria-label="Clients">{shown.map(client => <ClientCard key={client.id} client={client} summary={summaries.get(client.id)!} selected={selected.includes(client.id)} onSelect={() => toggle(client.id)} onOpen={() => setOpenId(client.id)} />)}</section>}
        </>
      ) : (
        <ClientDetail client={open} summary={summaries.get(open.id)!} visits={visits} runs={runs} onBack={() => setOpenId(null)} onBill={() => setReview({ ids: [open.id], mode: "INDIVIDUAL" })} />
      )}

      {/* Review drawer, shown before any billing. It lists exactly what will be billed so the user can check it.
          WIRING: lines come from planBilling(), which includes only EVV-compliant, completed, unbilled visits. "Confirm billing" calls confirm() above. */}
      <Drawer open={Boolean(review)} title={review?.ids.length === 1 ? `Bill ${nameOf(review.ids[0])}` : review?.all ? "Bill all clients" : "Bill group"} onClose={() => setReview(null)}>
        {review && plan ? (
          <div className="billing-review">
            {plan.lines.length ? (
              <table className="billing-table compact">
                <thead><tr><th>Client</th><th>Visits</th><th>Hours</th><th>Amount</th></tr></thead>
                <tbody>{plan.lines.map(line => <tr key={line.clientId}><td>{nameOf(line.clientId)}</td><td>{line.visitIds.length}</td><td>{formatHours(line.minutes)}</td><td>{formatMoney(line.amountCents)}</td></tr>)}</tbody>
                <tfoot><tr><th colSpan={2}>{plan.lines.length > 1 ? "Billed together" : "Total"}</th><th>{formatHours(plan.totalMinutes)}</th><th>{formatMoney(plan.totalCents)}</th></tr></tfoot>
              </table>
            ) : <p className="billing-empty">Nothing billable for the selected clients.</p>}
            {plan.skipped.length ? <p className="billing-muted">Left out, nothing billable: {plan.skipped.map(nameOf).join(", ")}.</p> : null}
            <p className="billing-muted">Only EVV-compliant visits are included. Visits that fail EVV are excluded and are not paid.</p>
            {!preview ? <p className="billing-note">Billing is not connected yet, so this cannot be submitted.</p> : null}
            <div className="billing-review-actions">
              <button type="button" className="secondary" onClick={() => setReview(null)}>Cancel</button>
              <button type="button" disabled={!preview || !plan.lines.length} onClick={confirm}>Confirm billing {formatMoney(plan.totalCents)}</button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

/**
 * Client detail view. WIRING: same sources as the cards, for one client.
 * "Bill now" bills only this client. The sections below are, in order: billable visits (EVV compliant and unbilled),
 * visits excluded for failing EVV with the reasons, and billing history (the billing-runs table).
 */
function ClientDetail({ client, summary, visits, runs, onBack, onBill }: { client: BillingClient; summary: ClientBillingSummary; visits: BillingVisit[]; runs: BillingRun[]; onBack: () => void; onBill: () => void }) {
  const billable = billableVisits(client.id, visits).sort((a, b) => (b.clockIn?.time ?? "").localeCompare(a.clockIn?.time ?? ""));
  const excluded = nonCompliantVisits(client.id, visits);
  const history = runs.filter(run => run.clientId === client.id).sort((a, b) => b.billedAt.localeCompare(a.billedAt));
  return (
    <section className="billing-detail">
      <div className="billing-detail-head">
        <div>
          <button type="button" className="secondary billing-back" onClick={onBack}>← All clients</button>
          <h2>{client.name}</h2>
          <p className="billing-muted">Service period {day(client.serviceStart ?? summary.firstVisitAt)} to {day(client.serviceEnd)} · Last billed {day(summary.lastBilledAt)}</p>
        </div>
        <button type="button" disabled={!summary.unbilledEvvCents} onClick={onBill}>Bill now {summary.unbilledEvvCents ? formatMoney(summary.unbilledEvvCents) : ""}</button>
      </div>

      <div className="billing-stats">
        <Stat label="Billable since last billing" value={formatHoursWithAmount(summary.unbilledEvvMinutes, summary.unbilledEvvCents)} note="EVV compliant" tone="good" />
        <Stat label="Not billable (non-EVV)" value={formatHoursWithAmount(summary.unbilledNonEvvMinutes, summary.unbilledNonEvvCents)} note={`${excluded.length} visits excluded`} tone="warning" />
        <Stat label="Billed since start of service" value={formatHoursWithAmount(summary.billedMinutes, summary.billedCents)} note={`${summary.runCount} billings`} />
        <Stat label="Total approved hours" value={approvedMinutes(client) === null ? "Not recorded" : formatHours(approvedMinutes(client)!)} note={approvedMinutes(client) === null ? "No authorization on file" : `(${approvedCents(client, summary) === null ? "—" : formatMoney(approvedCents(client, summary)!)}) · ${formatHours(summary.evvMinutes + summary.nonEvvMinutes)} worked`} />
      </div>

      <h3>Billable visits <span className="billing-count">{billable.length}</span></h3>
      <VisitTable visits={billable} />

      {/* WIRING: visits failing the EVV check. They are listed so staff can fix the record in AxisCare; once AxisCare sends the
          corrected visit (webhook, or the next poll with updatedSinceDate) the visit is re-evaluated and moves to the billable list. */}
      <h3>Not EVV compliant <span className="billing-count warning">{excluded.length}</span></h3>
      <p className="billing-muted">These visits will not be billed. Fix the record in AxisCare, or leave them out.</p>
      <VisitTable visits={excluded} showReasons />

      <h3>Billing history</h3>
      {history.length ? (
        <div className="billing-table-wrap"><table className="billing-table compact">
          <thead><tr><th>Billed</th><th>Hours</th><th>Amount</th></tr></thead>
          <tbody>{history.map(run => <tr key={`${run.id}-${run.clientId}`}><td>{day(run.billedAt)}</td><td>{formatHours(run.hours * 60)}</td><td>{formatMoney(run.amountCents)}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="billing-empty">Nothing has been billed for this client yet.</p>}
    </section>
  );
}
