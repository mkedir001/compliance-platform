"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import BillingResultDrawer from "./billing-result-drawer";
import { REASON_LABELS, day, hoursWithAmount, isBilled, money, pretty, resultLabel, stamp, summarizeVisits, type BillingClient, type BillingVisitRow } from "./billing-shared";
import "./billing.css";

function VisitTable({ visits, selected, onToggle, onToggleAll, selectable, onOpenResult }: { visits: BillingVisitRow[]; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void; selectable: boolean; onOpenResult: (id: string) => void }) {
  const open = visits.filter(visit => !isBilled(visit)), allSelected = open.length > 0 && open.every(visit => selected.has(visit.id));
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead><tr>
          {selectable ? <th className="billing-check-col"><input type="checkbox" aria-label="Select all shown visits" checked={allSelected} onChange={onToggleAll} /></th> : null}
          <th>Visit</th><th>Caregiver</th><th>Hours</th><th>Rate</th><th>Amount</th><th>EVV</th><th>Billing result</th></tr></thead>
        <tbody>{visits.map(visit => (
          <tr key={visit.id} className={`${visit.compliant ? "" : "billing-row-flagged"} ${selected.has(visit.id) ? "billing-row-selected" : ""}`.trim() || undefined}>
            {selectable ? <td className="billing-check-col"><input type="checkbox" aria-label={`Select visit ${stamp(visit.startAt)}`} checked={selected.has(visit.id)} disabled={isBilled(visit)} onChange={() => onToggle(visit.id)} /></td> : null}
            <td data-label="Visit">{stamp(visit.startAt)}<small>{visit.waldahServiceType ?? visit.serviceCode ?? "No service type"}{visit.serviceCode && visit.waldahServiceType ? ` · AxisCare ${visit.serviceCode}` : ""}</small></td>
            <td data-label="Caregiver">{visit.caregiverName ?? "Not recorded"}</td>
            <td data-label="Hours">{visit.hours === null ? "—" : visit.hours.toFixed(2)}</td>
            <td data-label="Rate">{visit.rateCents === null ? "No rate" : money(visit.rateCents)}</td>
            <td data-label="Amount">{visit.amountCents === null ? "—" : money(visit.amountCents)}</td>
            <td data-label="EVV">{visit.compliant ? <StatusChip tone="good">EVV compliant</StatusChip> : <>
              <StatusChip tone="danger">Not EVV compliant</StatusChip>
              <ul className="billing-reasons">{visit.reasons.map(reason => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul></>}</td>
            <td data-label="Billing result" className="billing-result-cell">
              <StatusChip tone={!visit.result ? "neutral" : visit.result.status === "BILLED" ? "good" : "danger"}>{resultLabel(visit.result, money)}</StatusChip>
              {visit.result ? <button type="button" className="billing-link" onClick={() => onOpenResult(visit.id)}>{visit.result.status === "BILLED" ? "View receipt" : "View error"} ›</button> : null}
            </td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function ClientBillingDetail({ client, visits, canRun, organizationId }: { client: BillingClient; visits: BillingVisitRow[]; canRun: boolean; organizationId: string }) {
  const [filter, setFilter] = useState<"ALL" | "EVV" | "NON_EVV">("ALL");
  const [billedFilter, setBilledFilter] = useState<"BILLED" | "NOT_BILLED" | null>(null);
  const [openResultId, setOpenResultId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const summary = summarizeVisits(visits);
  const nonEvv = visits.filter(visit => !visit.compliant);
  const shown = visits.filter(visit => (filter === "ALL" || (filter === "EVV" ? visit.compliant : !visit.compliant)) && (billedFilter === null || (billedFilter === "BILLED") === isBilled(visit)));
  const openResult = visits.find(visit => visit.id === openResultId && visit.result) ?? null;
  const linked = canRun && client.axisCareLinked;
  const picked = visits.filter(visit => selected.has(visit.id)), pickedSummary = summarizeVisits(picked);
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => { const open = shown.filter(visit => !isBilled(visit)); setSelected(current => open.every(visit => current.has(visit.id)) ? new Set([...current].filter(id => !open.some(visit => visit.id === id))) : new Set([...current, ...open.map(visit => visit.id)])); };
  return (
    <main className="admin-shell billing-shell billing-detail" aria-label={`Billing details for ${client.name}`}>
      <Link href={`/admin/billing?organizationId=${encodeURIComponent(organizationId)}`} className="billing-back-link">← All clients</Link>
      <header className="billing-detail-top">
        <div>
          <h1>{client.name}</h1>
          <p className="billing-muted">{client.axisCareClientId ? `AxisCare ID ${client.axisCareClientId} · ` : ""}Service period {day(client.serviceStart)} to {day(client.serviceEnd)}</p>
        </div>
        <StatusChip tone={client.status === "ACTIVE" ? "good" : "neutral"}>{pretty(client.status)}</StatusChip>
      </header>

      {!canRun ? <p className="billing-empty">Visit detail and billing are available to billing roles. Billed amounts will appear here once billing runs are enabled.</p>
        : !linked ? <p className="billing-empty">This client is not matched to an AxisCare client yet. Confirm the match on the Billing page to see visits.</p> : <>
        <section className="billing-summary" aria-label="Client billing snapshot">
          <span><b>{client.approvedHours === null ? "Not recorded" : `${client.approvedHours.toFixed(2)} h`}</b> approved</span>
          <span className="billing-bad"><b>{summary.nonEvvCount}</b> not EVV compliant</span>
          <span className="billing-good"><b>{summary.evvCount}</b> EVV compliant</span>
          <span><b>{hoursWithAmount(summary.readyHours, summary.readyCents, summary.unrated)}</b> ready to bill</span>
        </section>

        <section className="billing-bill-options" aria-label="Billing options">
          {/* WIRING: each button starts an individual billing session for this client. "Everything" = all unsubmitted visits;
              "EVV only" = unsubmitted visits where compliant === true. Non-EVV visits billed by choice are flagged in the session. */}
          <button type="button" disabled title="Billing sessions are not enabled yet">Bill everything<small>{hoursWithAmount(summary.readyHours, summary.readyCents, summary.unrated)} · {visits.length} {visits.length === 1 ? "visit" : "visits"}</small></button>
          <button type="button" className="secondary" disabled title="Billing sessions are not enabled yet">Bill EVV-compliant only<small>{hoursWithAmount(summary.evv.hours, summary.evv.cents, summary.evv.unrated)} · {summary.evvCount} {summary.evvCount === 1 ? "visit" : "visits"}</small></button>
        </section>
        <p className="billing-live billing-placeholder-note">Billing submission is not enabled yet. These controls show the planned workflow and cannot create a claim, invoice, or billing run.</p>

        <section aria-label="Billing history">
          <h2>Billing history</h2>
          {/* WIRING: list submitted billing runs for this client (date, hours, amount, EVV/non-EVV counts) from the billing ledger. */}
          <p className="billing-empty">No billing history yet. Past billing runs will appear here once billing is enabled.</p>
        </section>

        {nonEvv.length ? (
          <details className="billing-noncompliant" aria-label="Visits that are not EVV compliant">
            <summary><h2>Not EVV compliant <span className="billing-count danger">{nonEvv.length}</span></h2></summary>
            <p className="billing-muted">These visits are missing something required for EVV. Fix them in AxisCare, or choose “Bill everything” to include them.</p>
            <ul>{nonEvv.map(visit => <li key={visit.id}><b>{stamp(visit.startAt)}</b><span>{visit.reasons.map(reason => REASON_LABELS[reason] ?? reason).join(" · ")}</span></li>)}</ul>
          </details>
        ) : null}

        <section aria-label="Visit history">
          <div className="billing-section-head">
            <div className="billing-section-title">
              <h2>Visit history <span className="billing-count">{visits.length}</span></h2>
              <div className="billing-toggles" role="group" aria-label="Filter by billing status">
                <button type="button" aria-pressed={billedFilter === "BILLED"} onClick={() => setBilledFilter(billedFilter === "BILLED" ? null : "BILLED")}>Billed</button>
                <button type="button" aria-pressed={billedFilter === "NOT_BILLED"} onClick={() => setBilledFilter(billedFilter === "NOT_BILLED" ? null : "NOT_BILLED")}>Not billed</button>
              </div>
            </div>
            <div className="billing-segmented" role="group" aria-label="Filter visits by EVV status">
              <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>All</button>
              <button type="button" aria-pressed={filter === "EVV"} onClick={() => setFilter("EVV")}>EVV compliant</button>
              <button type="button" aria-pressed={filter === "NON_EVV"} onClick={() => setFilter("NON_EVV")}>Not EVV compliant</button>
            </div>
          </div>
          {visits.length === 0 ? <p className="billing-empty">No AxisCare visits have synced for this client in the last 12 months.</p>
            : shown.length === 0 ? <p className="billing-empty">No visits match these filters.</p> : <>
              {selected.size ? <div className="billing-group-bar" role="status">
                <b>{selected.size} {selected.size === 1 ? "visit" : "visits"} selected</b>
                <span>{hoursWithAmount(pickedSummary.readyHours, pickedSummary.readyCents, pickedSummary.unrated)}{pickedSummary.nonEvvCount ? ` · ${pickedSummary.nonEvvCount} not EVV compliant` : ""}</span>
                {/* WIRING: start a billing session for exactly these visit ids (selected state). */}
                <button type="button" disabled title="Billing sessions are not enabled yet">Bill selected</button>
                <button type="button" className="secondary" onClick={() => setSelected(new Set())}>Clear</button>
              </div> : null}
              <VisitTable visits={shown} selected={selected} onToggle={toggle} onToggleAll={toggleAll} selectable onOpenResult={setOpenResultId} />
            </>}
        </section>

        {openResult ? <BillingResultDrawer visit={openResult} clientName={client.name} onClose={() => setOpenResultId(null)} /> : null}
      </>}
    </main>
  );
}
