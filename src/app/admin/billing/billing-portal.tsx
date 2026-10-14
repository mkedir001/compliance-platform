"use client";
import "./billing.css";
import { useMemo, useState } from "react";
import { Drawer, StatusChip } from "@/app/components/portal-ui";
import {
  EVV_ISSUE_LABELS, applyBillingPlan, billableVisits, formatHours, formatHoursWithAmount, formatMoney, nonCompliantVisits, planBilling, summarizeClient,
  type BillingMode, type BillingRun, type BillingVisit, type ClientBillingSummary,
} from "@/domain/billing/evv";
import { sampleBillingData } from "@/domain/billing/sample";

export type BillingClient = { id: string; name: string; status: string; serviceStart: string | null; serviceEnd: string | null; approvedHours: number | null };

const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const day = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)) : "—");
const clock = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—");

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "warning" }) {
  return <p className={`billing-stat${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</p>;
}

/** Approved hours for the service period, priced at the client's current rate. */
const approvedMinutes = (client: BillingClient) => (client.approvedHours === null ? null : Math.round(client.approvedHours * 60));
const approvedCents = (client: BillingClient, summary: ClientBillingSummary) => (client.approvedHours === null || summary.latestRateCents === null ? null : Math.round(client.approvedHours * summary.latestRateCents));

function Figure({ label, minutes, cents }: { label: string; minutes: number | null; cents: number | null }) {
  return <span><small>{label}</small><b>{minutes === null ? "Not recorded" : formatHours(minutes)}</b><em>{minutes === null ? "" : `(${cents === null ? "—" : formatMoney(cents)})`}</em></span>;
}

function ClientCard({ client, summary, selected, onSelect, onOpen }: { client: BillingClient; summary: ClientBillingSummary; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <article className={`billing-card${selected ? " selected" : ""}`}>
      <label className="billing-card-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${client.name} for group billing`} /></label>
      <button type="button" className="billing-card-open" onClick={onOpen} aria-label={`Open billing for ${client.name}`}>
        <span className="billing-card-head"><strong>{client.name}</strong><StatusChip tone={client.status === "ACTIVE" ? "good" : "neutral"}>{pretty(client.status)}</StatusChip></span>
        <span className="billing-card-grid">
          <Figure label="Total approved hours" minutes={approvedMinutes(client)} cents={approvedCents(client, summary)} />
          <Figure label="Billed since start of service" minutes={summary.billedMinutes} cents={summary.billedCents} />
          <Figure label="Since last billing" minutes={summary.unbilledEvvMinutes} cents={summary.unbilledEvvCents} />
        </span>
        <span className="billing-card-foot">
          {summary.nonEvvVisitCount ? <StatusChip tone="warning">{summary.nonEvvVisitCount} non-EVV visits, not billable</StatusChip> : <span className="billing-muted">All visits EVV compliant</span>}
        </span>
      </button>
    </article>
  );
}

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
  const [visits, setVisits] = useState<BillingVisit[]>([]);
  const [runs, setRuns] = useState<BillingRun[]>([]);
  const [search, setSearch] = useState("");
  const [onlyBillable, setOnlyBillable] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<{ ids: string[]; mode: BillingMode; all?: boolean } | null>(null);
  const [notice, setNotice] = useState("");

  const summaries = useMemo(() => new Map(clients.map(client => [client.id, summarizeClient(client.id, visits, runs)])), [clients, visits, runs]);
  const shown = clients.filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase()) && (!onlyBillable || (summaries.get(client.id)?.unbilledEvvCents ?? 0) > 0));
  const totals = [...summaries.values()].reduce((sum, item) => ({ billable: sum.billable + item.unbilledEvvCents, excluded: sum.excluded + item.unbilledNonEvvCents, billed: sum.billed + item.billedCents, hours: sum.hours + item.unbilledEvvMinutes, excludedMinutes: sum.excludedMinutes + item.unbilledNonEvvMinutes, billedMinutes: sum.billedMinutes + item.billedMinutes }), { billable: 0, excluded: 0, billed: 0, hours: 0, excludedMinutes: 0, billedMinutes: 0 });
  const open = openId ? clients.find(client => client.id === openId) ?? null : null;
  const billableIds = clients.filter(client => (summaries.get(client.id)?.unbilledEvvCents ?? 0) > 0).map(client => client.id);
  const plan = review ? planBilling(review.ids, visits, review.mode) : null;
  const nameOf = (id: string) => clients.find(client => client.id === id)?.name ?? id;

  function togglePreview() {
    setNotice("");
    if (preview) { setPreview(false); setVisits([]); setRuns([]); return; }
    const sample = sampleBillingData(clients.map(client => client.id));
    setVisits(sample.visits); setRuns(sample.runs); setPreview(true);
  }
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
          <section className="billing-stats" aria-label="Billing totals">
            <Stat label="Billable now (EVV compliant)" value={formatHoursWithAmount(totals.hours, totals.billable)} note="EVV compliant, not yet billed" tone="good" />
            <Stat label="Not billable (non-EVV)" value={formatHoursWithAmount(totals.excludedMinutes, totals.excluded)} note="Excluded until fixed" tone="warning" />
            <Stat label="Billed to date" value={formatHoursWithAmount(totals.billedMinutes, totals.billed)} />
            <Stat label="Clients" value={String(clients.length)} note={`${billableIds.length} with billable visits`} />
          </section>

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
