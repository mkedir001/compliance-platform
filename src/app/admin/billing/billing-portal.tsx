"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import IntegrationPanel from "./integration-panel";
import MatchReview from "./match-review";
import { hoursWithAmount, money, pretty, summarizeVisits, type AxisCareConnectionView, type BillingClient, type BillingVisitRow, type PendingMatch } from "./billing-shared";
import "./billing.css";

export type { AxisCareConnectionView, BillingClient, BillingVisitRow, PendingMatch } from "./billing-shared";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export default function BillingPortal({ clients, canRun = false, canManageIntegration = false, visits = [], matches = [], organizationId = "", connection }: { clients: BillingClient[]; canRun?: boolean; canManageIntegration?: boolean; visits?: BillingVisitRow[]; matches?: PendingMatch[]; organizationId?: string; connection: AxisCareConnectionView }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = `?organizationId=${encodeURIComponent(organizationId)}`;
  const rows = useMemo(() => clients
    .filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map(client => {
      const own = visits.filter(visit => visit.clientId === client.id);
      const errors = own.filter(visit => visit.result?.status === "ERROR").length;
      const billedCents = own.reduce((total, visit) => total + (visit.result?.status === "BILLED" ? visit.result.amountCents : 0), 0);
      return { client, summary: summarizeVisits(own), errors, billedCents };
    }), [clients, visits, search]);
  // WIRING: results come from the billing ledger; until then no visit has one and the strip and badges stay hidden.
  const errorClients = rows.filter(row => row.errors > 0), billedClients = rows.filter(row => row.errors === 0 && row.billedCents > 0);
  const billable = rows.filter(row => canRun && row.client.axisCareLinked);
  const selectedRows = billable.filter(row => picked.has(row.client.id));
  const selectedTotals = summarizeVisits(selectedRows.flatMap(row => visits.filter(visit => visit.clientId === row.client.id)));
  const allPicked = billable.length > 0 && billable.every(row => picked.has(row.client.id));
  const toggle = (id: string) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(billable.map(row => row.client.id)));
  const totals = summarizeVisits(visits);

  return (
    <main className="admin-shell billing-shell" aria-label="Organization billing workspace">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Billing</h1>
          <p className="lede">{canRun ? "Visits synced from AxisCare, ready to bill." : "Amounts billed for your clients."}</p>
        </div>
      </header>

      {canManageIntegration ? <IntegrationPanel organizationId={organizationId} initial={connection} /> : null}
      {canRun ? <MatchReview matches={matches} organizationId={organizationId} /> : null}

      <section className="billing-summary" aria-label="Billing summary">
        <span><b>{clients.length}</b> {clients.length === 1 ? "client" : "clients"}</span>
        {canRun ? <>
          <span className="billing-bad"><b>{totals.nonEvvCount}</b> not EVV compliant</span>
          <span className="billing-good"><b>{totals.evvCount}</b> EVV compliant</span>
          <span><b>{hoursWithAmount(totals.readyHours, totals.readyCents, totals.unrated)}</b> ready to bill</span>
        </> : <span className="billing-muted">Visit detail is available to billing roles.</span>}
      </section>

      {errorClients.length || billedClients.length ? (
        <section className={`billing-outcomes${errorClients.length ? " has-errors" : ""}`} aria-label="Latest billing results">
          {errorClients.length ? <b className="billing-bad">{errorClients.length} {errorClients.length === 1 ? "client" : "clients"} had errors</b> : null}
          {errorClients.map(row => <span key={row.client.id}>{row.client.name}: {row.errors} {row.errors === 1 ? "visit" : "visits"} not billed.</span>)}
          {billedClients.map(row => <span key={row.client.id} className="billing-muted">{row.client.name} billed {money(row.billedCents)}.</span>)}
        </section>
      ) : null}

      <div className="billing-toolbar" aria-label="Billing client filters">
        <label className="billing-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search clients" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /></label>
      </div>

      {selectedRows.length ? (
        <div className="billing-group-bar" role="region" aria-label="Group billing">
          <strong>{selectedRows.length} {selectedRows.length === 1 ? "client" : "clients"} selected</strong>
          <span>{hoursWithAmount(selectedTotals.readyHours, selectedTotals.readyCents, selectedTotals.unrated)} ready to bill</span>
          <span className="billing-group-actions">
            {/* WIRING: start ONE group billing session for the selected client ids (see billing session design). */}
            <button type="button" disabled title="Billing sessions are not enabled yet">Group billing</button>
            <button type="button" className="secondary" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      ) : null}
      {canRun ? <p className="billing-live billing-placeholder-note">Billing submission is not enabled yet. Review and selection controls are available, but no claim, invoice, or billing run can be created.</p> : null}

      {clients.length === 0 ? <p className="billing-empty">There are no clients available in this organization.</p>
        : rows.length === 0 ? <p className="billing-empty">No clients match this search.</p>
        : (
          <div className="workforce-table billing-directory" role="table" aria-label="Clients">
            <div className="billing-directory-head" role="row">
              <span role="columnheader">{canRun ? <input type="checkbox" aria-label="Select all billable clients" checked={allPicked} disabled={billable.length === 0} onChange={toggleAll} /> : null}</span>
              <span role="columnheader">Client</span><span role="columnheader">Not EVV compliant</span><span role="columnheader">EVV compliant</span><span role="columnheader">Ready to bill</span><span role="columnheader"><span className="sr-only">Actions</span></span>
            </div>
            {rows.map(({ client, summary, errors, billedCents }) => {
              const linked = canRun && client.axisCareLinked;
              const detail = `/admin/billing/${client.id}${query}`;
              return (
                <div key={client.id} role="row" className={`billing-directory-row${picked.has(client.id) ? " selected" : ""}`} onClick={event => { if (!(event.target as HTMLElement).closest("input,button,a")) router.push(detail); }}>
                  <span role="cell">{canRun ? <input type="checkbox" aria-label={`Select ${client.name} for group billing`} checked={picked.has(client.id)} disabled={!linked} onChange={() => toggle(client.id)} /> : null}</span>
                  <Link href={detail} role="cell" className="billing-name" aria-label={`Open billing details for ${client.name}`}>
                    <span className="directory-avatar" aria-hidden="true">{initials(client.name)}</span>
                    <span><strong>{client.name}</strong>{errors ? <StatusChip tone="danger">{errors} billing {errors === 1 ? "error" : "errors"}</StatusChip> : billedCents ? <StatusChip tone="good">Billed · {money(billedCents)}</StatusChip> : null}<small>{client.axisCareClientId ? `AxisCare ID ${client.axisCareClientId}` : canRun ? "Not matched to AxisCare" : pretty(client.status)}</small></span>
                  </Link>
                  {canRun ? (linked ? <>
                    <span role="cell" data-label="Not EVV compliant" className={summary.nonEvvCount ? "billing-bad" : "billing-muted"}><b>{summary.nonEvvCount}</b> {summary.nonEvvCount === 1 ? "visit" : "visits"}</span>
                    <span role="cell" data-label="EVV compliant" className={summary.evvCount ? "billing-good" : "billing-muted"}><b>{summary.evvCount}</b> {summary.evvCount === 1 ? "visit" : "visits"}</span>
                    <span role="cell" data-label="Ready to bill"><b>{hoursWithAmount(summary.readyHours, summary.readyCents, summary.unrated)}</b></span>
                  </> : <span role="cell" className="billing-unmatched">Confirm the AxisCare match to see visits</span>)
                    : <span role="cell" className="billing-muted">—</span>}
                  <span role="cell" className="billing-row-actions">
                    {canRun ? <button type="button" disabled title="Billing sessions are not enabled yet" aria-label={`Bill now for ${client.name}`}>Bill now</button> : null}
                    <Link href={detail} className="billing-more">More details ›</Link>
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </main>
  );
}
