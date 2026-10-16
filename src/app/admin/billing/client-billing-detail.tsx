"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { REASON_LABELS, day, hoursWithAmount, money, pretty, stamp, summarizeVisits, type BillingClient, type BillingVisitRow } from "./billing-shared";
import "./billing.css";

const NOT_ENABLED = "Billing sessions are not enabled yet. This button is ready to be connected.";

function VisitTable({ visits }: { visits: BillingVisitRow[] }) {
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead><tr><th>Visit</th><th>Clock in / out</th><th>Hours</th><th>Rate</th><th>Amount</th><th>EVV</th></tr></thead>
        <tbody>{visits.map(visit => (
          <tr key={visit.id} className={visit.compliant ? undefined : "billing-row-flagged"}>
            <td data-label="Visit">{stamp(visit.startAt)}<small>{visit.waldahServiceType ?? visit.serviceCode ?? "No service type"}{visit.serviceCode && visit.waldahServiceType ? ` · AxisCare ${visit.serviceCode}` : ""}</small></td>
            <td data-label="Clock in / out">{stamp(visit.clockInAt)}<small>{stamp(visit.clockOutAt)}</small></td>
            <td data-label="Hours">{visit.hours === null ? "—" : visit.hours.toFixed(2)}</td>
            <td data-label="Rate">{visit.rateCents === null ? "No rate" : money(visit.rateCents)}</td>
            <td data-label="Amount">{visit.amountCents === null ? "—" : money(visit.amountCents)}</td>
            <td data-label="EVV">{visit.compliant ? <StatusChip tone="good">EVV compliant</StatusChip> : <>
              <StatusChip tone="danger">Not EVV compliant</StatusChip>
              <ul className="billing-reasons">{visit.reasons.map(reason => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul></>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function ClientBillingDetail({ client, visits, canRun, organizationId }: { client: BillingClient; visits: BillingVisitRow[]; canRun: boolean; organizationId: string }) {
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"ALL" | "NON_EVV">("ALL");
  const summary = summarizeVisits(visits);
  const nonEvv = visits.filter(visit => !visit.compliant);
  const shown = filter === "NON_EVV" ? nonEvv : visits;
  const linked = canRun && client.axisCareLinked;
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
          <button type="button" disabled={visits.length === 0} onClick={() => setNotice(NOT_ENABLED)}>Bill everything<small>{hoursWithAmount(summary.readyHours, summary.readyCents, summary.unrated)} · {visits.length} {visits.length === 1 ? "visit" : "visits"}</small></button>
          <button type="button" className="secondary" disabled={summary.evvCount === 0} onClick={() => setNotice(NOT_ENABLED)}>Bill EVV-compliant only<small>{hoursWithAmount(summary.evv.hours, summary.evv.cents, summary.evv.unrated)} · {summary.evvCount} {summary.evvCount === 1 ? "visit" : "visits"}</small></button>
        </section>
        <p className="billing-live" role="status" aria-live="polite">{notice}</p>

        {nonEvv.length ? (
          <section className="billing-noncompliant" aria-label="Visits that are not EVV compliant">
            <h2>Not EVV compliant <span className="billing-count danger">{nonEvv.length}</span></h2>
            <p className="billing-muted">These visits are missing something required for EVV. Fix them in AxisCare, or choose “Bill everything” to include them.</p>
            <ul>{nonEvv.map(visit => <li key={visit.id}><b>{stamp(visit.startAt)}</b><span>{visit.reasons.map(reason => REASON_LABELS[reason] ?? reason).join(" · ")}</span></li>)}</ul>
          </section>
        ) : null}

        <section aria-label="Visit history">
          <div className="billing-section-head">
            <h2>Visit history <span className="billing-count">{visits.length}</span></h2>
            <div className="billing-segmented" role="group" aria-label="Filter visits">
              <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>All</button>
              <button type="button" aria-pressed={filter === "NON_EVV"} onClick={() => setFilter("NON_EVV")}>Not EVV compliant</button>
            </div>
          </div>
          {visits.length === 0 ? <p className="billing-empty">No AxisCare visits have synced for this client in the last 12 months.</p>
            : shown.length === 0 ? <p className="billing-empty">Every visit is EVV compliant.</p> : <VisitTable visits={shown} />}
        </section>

        <section aria-label="Billing history">
          <h2>Billing history</h2>
          {/* WIRING: list submitted billing runs for this client (date, hours, amount, EVV/non-EVV counts) from the billing ledger. */}
          <p className="billing-empty">No billing history yet. Past billing runs will appear here once billing is enabled.</p>
        </section>
      </>}
    </main>
  );
}
