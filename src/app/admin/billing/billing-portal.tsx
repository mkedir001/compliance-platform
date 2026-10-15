"use client";

import { useMemo, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import "./billing.css";

export type BillingClient = {
  id: string;
  name: string;
  status: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  approvedHours: number | null;
  axisCareLinked: boolean;
};
export type BillingVisitRow = {
  id: string; clientId: string; startAt: string | null; clockInAt: string | null; clockOutAt: string | null; serviceCode: string | null;
  hours: number | null; rateCents: number | null; amountCents: number | null; compliant: boolean; reasons: string[];
};
export type PendingMatch = { id: string; axisCareClientId: string; axisCareName: string; axisCareDateOfBirth: string | null; clientId: string; clientName: string; clientDateOfBirth: string | null; reason: string; score: number };

const REASON_LABELS: Record<string, string> = {
  MISSING_CLOCK_IN: "No clock-in time", MISSING_CLOCK_OUT: "No clock-out time", CLOCK_OUT_BEFORE_IN: "Clock-out is before clock-in",
  MISSING_CLOCK_IN_LOCATION: "No location at clock-in", MISSING_CLOCK_OUT_LOCATION: "No location at clock-out", MISSING_SERVICE: "No service type"
};
const money = (cents: number | null) => cents === null ? "No rate" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
const stamp = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—";

const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
const day = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
  : "Not recorded";
const hours = (value: number | null) => value === null ? "Not recorded" : `${value.toFixed(2)} h`;

function ClientCard({ client, onOpen }: { client: BillingClient; onOpen: () => void }) {
  return (
    <article className="billing-card">
      <button type="button" className="billing-card-open" onClick={onOpen} aria-label={`Open billing readiness for ${client.name}`}>
        <span className="billing-card-head">
          <strong>{client.name}</strong>
          <StatusChip tone={client.status === "ACTIVE" ? "good" : "neutral"}>{pretty(client.status)}</StatusChip>
        </span>
        <span className="billing-card-grid">
          <span><small>Approved service hours</small><b>{hours(client.approvedHours)}</b><em>From current service records</em></span>
          <span><small>Billed since service start</small><b>Not connected</b><em>No billing ledger is configured</em></span>
          <span><small>Available to bill</small><b>Not connected</b><em>No verified visit feed is configured</em></span>
        </span>
        <span className="billing-card-foot"><span className="billing-muted">View service-period context</span></span>
      </button>
    </article>
  );
}

function MatchReview({ matches, organizationId }: { matches: PendingMatch[]; organizationId: string }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = matches.filter(match => !done[match.id]);
  if (matches.length === 0) return null;
  async function decide(match: PendingMatch, action: "CONFIRM" | "REJECT") {
    setBusy(match.id); setError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/axiscare/matches/${match.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error("not saved");
      setDone(current => ({ ...current, [match.id]: action === "CONFIRM" ? "Linked" : "Rejected" }));
    } catch { setError("That could not be saved. Try again."); } finally { setBusy(null); }
  }
  return (
    <section className="billing-review" aria-label="AxisCare client matches to confirm">
      <div>
        <strong>{open.length} AxisCare {open.length === 1 ? "client needs" : "clients need"} to be matched</strong>
        <p className="billing-muted">Confirm once. After that the AxisCare client ID stays on the Waldah client and is used for billing.</p>
      </div>
      {error ? <p className="billing-note" role="alert">{error}</p> : null}
      <div className="billing-table-wrap">
        <table className="billing-table">
          <thead><tr><th>AxisCare client</th><th>Waldah client</th><th>Why suggested</th><th><span className="sr-only">Decision</span></th></tr></thead>
          <tbody>{matches.map(match => (
            <tr key={match.id}>
              <td data-label="AxisCare client">{match.axisCareName}<small>{match.axisCareDateOfBirth ? `Born ${day(match.axisCareDateOfBirth)}` : "No date of birth"}</small></td>
              <td data-label="Waldah client">{match.clientName}<small>{match.clientDateOfBirth ? `Born ${day(match.clientDateOfBirth)}` : "No date of birth"}</small></td>
              <td data-label="Why suggested">{match.reason}</td>
              <td data-label="Decision">{done[match.id] ? <StatusChip tone={done[match.id] === "Linked" ? "good" : "neutral"}>{done[match.id]}</StatusChip> : (
                <span className="billing-actions">
                  <button type="button" disabled={busy === match.id} onClick={() => decide(match, "CONFIRM")}>Confirm match</button>
                  <button type="button" className="secondary" disabled={busy === match.id} onClick={() => decide(match, "REJECT")}>Not the same person</button>
                </span>)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function BillingPortal({ clients, canRun = false, visits = [], matches = [], organizationId = "" }: { clients: BillingClient[]; canRun?: boolean; visits?: BillingVisitRow[]; matches?: PendingMatch[]; organizationId?: string }) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => clients.filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase())), [clients, search]);
  const open = openId ? clients.find(client => client.id === openId) ?? null : null;
  const authorizationCount = clients.filter(client => client.approvedHours !== null).length;

  return (
    <main className="admin-shell billing-shell" aria-label="Organization billing workspace">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Billing</h1>
          <p className="lede">Review client service-period context while billing integrations remain safely unavailable.</p>
        </div>
      </header>

      <section className="billing-banner" role="status">
        <div>
          <strong>{canRun ? "Visits are read from AxisCare. Billing runs are not enabled yet." : "You can view billed amounts. Billing is limited to billing roles."}</strong>
          <p>No claims, invoices, or billing runs can be submitted or changed from this screen.</p>
        </div>
        <button type="button" className="secondary" disabled aria-disabled="true">Billing actions unavailable</button>
      </section>

      {canRun ? <MatchReview matches={matches} organizationId={organizationId} /> : null}

      {!open ? (
        <>
          <section className="billing-stats" aria-label="Billing workspace status">
            <p className="billing-stat"><span>Clients</span><strong>{clients.length}</strong><small>Current organization only</small></p>
            <p className="billing-stat"><span>Service authorizations</span><strong>{authorizationCount}</strong><small>Clients with approved hours recorded</small></p>
            <p className="billing-stat warning"><span>Visit feed</span><strong>Not connected</strong><small>No EVV status is calculated</small></p>
            <p className="billing-stat warning"><span>Billing ledger</span><strong>Not connected</strong><small>No financial totals are displayed</small></p>
          </section>

          <section className="billing-toolbar" aria-label="Billing client filters">
            <label className="billing-search">Search clients<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name" /></label>
          </section>

          {clients.length === 0 ? <p className="billing-empty">There are no clients available in this organization.</p>
            : shown.length === 0 ? <p className="billing-empty">No clients match this search.</p>
            : <section className="billing-grid" aria-label="Clients">{shown.map(client => <ClientCard key={client.id} client={client} onOpen={() => setOpenId(client.id)} />)}</section>}
        </>
      ) : <ClientDetail client={open} canRun={canRun} visits={visits.filter(visit => visit.clientId === open.id)} onBack={() => setOpenId(null)} />}
    </main>
  );
}

function VisitList({ visits }: { visits: BillingVisitRow[] }) {
  // Selection is local to this screen. EVV-compliant visits start selected; others can be added by hand.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(visits.filter(visit => visit.compliant).map(visit => visit.id)));
  const chosen = visits.filter(visit => selected.has(visit.id));
  const totalHours = chosen.reduce((sum, visit) => sum + (visit.hours ?? 0), 0);
  const unrated = chosen.some(visit => visit.rateCents === null);
  const totalCents = chosen.reduce((sum, visit) => sum + (visit.amountCents ?? 0), 0);
  const manual = chosen.filter(visit => !visit.compliant).length;
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  if (visits.length === 0) return <p className="billing-empty">No AxisCare visits have synced for this client yet.</p>;
  return (
    <>
      <p className="billing-hint">EVV-compliant visits are selected. Visits that are not EVV compliant can be added by hand, and are flagged when added.</p>
      <div className="billing-table-wrap">
        <table className="billing-table">
          <thead><tr><th>Bill</th><th>Visit</th><th>Clock in / out</th><th>Hours</th><th>Rate</th><th>Amount</th><th>EVV</th></tr></thead>
          <tbody>{visits.map(visit => (
            <tr key={visit.id} className={visit.compliant ? undefined : "billing-row-flagged"}>
              <td data-label="Bill"><input type="checkbox" checked={selected.has(visit.id)} onChange={() => toggle(visit.id)} aria-label={`Include visit on ${stamp(visit.startAt)}`} /></td>
              <td data-label="Visit">{stamp(visit.startAt)}<small>{visit.serviceCode ?? "No service type"}</small></td>
              <td data-label="Clock in / out">{stamp(visit.clockInAt)}<small>{stamp(visit.clockOutAt)}</small></td>
              <td data-label="Hours">{visit.hours === null ? "—" : visit.hours.toFixed(2)}</td>
              <td data-label="Rate">{visit.rateCents === null ? "No rate" : money(visit.rateCents)}</td>
              <td data-label="Amount">{money(visit.amountCents)}</td>
              <td data-label="EVV">{visit.compliant ? <StatusChip tone="good">EVV compliant</StatusChip> : <>
                <StatusChip tone="warning">Not EVV compliant</StatusChip>
                <ul className="billing-reasons">{visit.reasons.map(reason => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul></>}</td>
            </tr>))}</tbody>
          <tfoot><tr><th colSpan={3}>Selected: {chosen.length} {chosen.length === 1 ? "visit" : "visits"}{manual ? ` (${manual} added by hand, not EVV compliant)` : ""}</th><th>{totalHours.toFixed(2)} h</th><th></th><th>{money(totalCents)}{unrated ? " + unrated visits" : ""}</th><th></th></tr></tfoot>
        </table>
      </div>
    </>
  );
}

function ClientDetail({ client, canRun, visits, onBack }: { client: BillingClient; canRun: boolean; visits: BillingVisitRow[]; onBack: () => void }) {
  return (
    <section className="billing-detail" aria-label={`Billing readiness for ${client.name}`}>
      <div className="billing-detail-head">
        <div>
          <button type="button" className="secondary billing-back" onClick={onBack}>← All clients</button>
          <h2>{client.name}</h2>
          <p className="billing-muted">Service period {day(client.serviceStart)} to {day(client.serviceEnd)}</p>
        </div>
        <StatusChip tone={client.status === "ACTIVE" ? "good" : "neutral"}>{pretty(client.status)}</StatusChip>
      </div>

      <div className="billing-stats">
        <p className="billing-stat"><span>Approved service hours</span><strong>{hours(client.approvedHours)}</strong><small>From organization service records</small></p>
        <p className="billing-stat warning"><span>Billable visits</span><strong>Unavailable</strong><small>A verified visit source is required</small></p>
        <p className="billing-stat warning"><span>Billing history</span><strong>Unavailable</strong><small>A billing ledger is required</small></p>
      </div>

      {canRun ? (client.axisCareLinked
        ? <><h3>Visits from AxisCare <span className="billing-count">{visits.length}</span></h3><VisitList key={client.id} visits={visits} /></>
        : <p className="billing-empty">This client is not matched to an AxisCare client yet, so no visits are shown.</p>)
        : <p className="billing-empty">Visit detail is available to billing roles.</p>}

      <section className="billing-empty" aria-label="Unsupported billing actions">
        <strong>Billing actions are disabled.</strong>
        <p>This screen does not create claims, invoices, billing runs, service authorizations, or financial transactions.</p>
      </section>
    </section>
  );
}
