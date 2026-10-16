"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import IntegrationPanel from "./integration-panel";
import MatchReview from "./match-review";
import { hoursWithAmount, pretty, summarizeVisits, type AxisCareConnectionView, type BillingClient, type BillingVisitRow, type PendingMatch } from "./billing-shared";
import "./billing.css";

export type { AxisCareConnectionView, BillingClient, BillingVisitRow, PendingMatch } from "./billing-shared";

const NOT_ENABLED = "Billing sessions are not enabled yet. This button is ready to be connected.";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export default function BillingPortal({ clients, canRun = false, canManageIntegration = false, visits = [], matches = [], organizationId = "", connection }: { clients: BillingClient[]; canRun?: boolean; canManageIntegration?: boolean; visits?: BillingVisitRow[]; matches?: PendingMatch[]; organizationId?: string; connection: AxisCareConnectionView }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const query = `?organizationId=${encodeURIComponent(organizationId)}`;
  const rows = useMemo(() => clients
    .filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map(client => ({ client, summary: summarizeVisits(visits.filter(visit => visit.clientId === client.id)) })), [clients, visits, search]);
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

      <div className="billing-toolbar" aria-label="Billing client filters">
        <label className="billing-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search clients" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /></label>
      </div>

      {selectedRows.length ? (
        <div className="billing-group-bar" role="region" aria-label="Group billing">
          <strong>{selectedRows.length} {selectedRows.length === 1 ? "client" : "clients"} selected</strong>
          <span>{hoursWithAmount(selectedTotals.readyHours, selectedTotals.readyCents, selectedTotals.unrated)} ready to bill</span>
          <span className="billing-group-actions">
            {/* WIRING: start ONE group billing session for the selected client ids (see billing session design). */}
            <button type="button" onClick={() => setNotice(NOT_ENABLED)}>Group billing</button>
            <button type="button" className="secondary" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      ) : null}
      <p className="billing-live" role="status" aria-live="polite">{notice}</p>

      {clients.length === 0 ? <p className="billing-empty">There are no clients available in this organization.</p>
        : rows.length === 0 ? <p className="billing-empty">No clients match this search.</p>
        : (
          <div className="workforce-table billing-directory" role="table" aria-label="Clients">
            <div className="billing-directory-head" role="row">
              <span>{canRun ? <input type="checkbox" aria-label="Select all billable clients" checked={allPicked} disabled={billable.length === 0} onChange={toggleAll} /> : null}</span>
              <span>Client</span><span>Not EVV compliant</span><span>EVV compliant</span><span>Ready to bill</span><span><span className="sr-only">Actions</span></span>
            </div>
            {rows.map(({ client, summary }) => {
              const linked = canRun && client.axisCareLinked;
              const detail = `/admin/billing/${client.id}${query}`;
              return (
                <div key={client.id} role="row" className={`billing-directory-row${picked.has(client.id) ? " selected" : ""}`} onClick={event => { if (!(event.target as HTMLElement).closest("input,button,a")) router.push(detail); }}>
                  <span>{canRun ? <input type="checkbox" aria-label={`Select ${client.name} for group billing`} checked={picked.has(client.id)} disabled={!linked} onChange={() => toggle(client.id)} /> : null}</span>
                  <Link href={detail} className="billing-name" aria-label={`Open billing details for ${client.name}`}>
                    <span className="directory-avatar" aria-hidden="true">{initials(client.name)}</span>
                    <span><strong>{client.name}</strong><small>{client.axisCareClientId ? `AxisCare ID ${client.axisCareClientId}` : canRun ? "Not matched to AxisCare" : pretty(client.status)}</small></span>
                  </Link>
                  {canRun ? (linked ? <>
                    <span data-label="Not EVV compliant" className={summary.nonEvvCount ? "billing-bad" : "billing-muted"}><b>{summary.nonEvvCount}</b> {summary.nonEvvCount === 1 ? "visit" : "visits"}</span>
                    <span data-label="EVV compliant" className={summary.evvCount ? "billing-good" : "billing-muted"}><b>{summary.evvCount}</b> {summary.evvCount === 1 ? "visit" : "visits"}</span>
                    <span data-label="Ready to bill"><b>{hoursWithAmount(summary.readyHours, summary.readyCents, summary.unrated)}</b></span>
                  </> : <span className="billing-unmatched">Confirm the AxisCare match to see visits</span>)
                    : <span className="billing-muted">—</span>}
                  <span className="billing-row-actions">
                    {canRun ? <button type="button" disabled={!linked || summary.readyHours === 0} onClick={() => setNotice(NOT_ENABLED)} aria-label={`Bill now for ${client.name}`}>Bill now</button> : null}
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
