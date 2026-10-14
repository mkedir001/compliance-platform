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
};

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

export default function BillingPortal({ clients }: { clients: BillingClient[] }) {
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
          <strong>Billing and visit data are not connected.</strong>
          <p>No claims, invoices, visits, rates, or financial totals can be submitted or changed from this screen.</p>
        </div>
        <button type="button" className="secondary" disabled aria-disabled="true">Billing actions unavailable</button>
      </section>

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
      ) : <ClientDetail client={open} onBack={() => setOpenId(null)} />}
    </main>
  );
}

function ClientDetail({ client, onBack }: { client: BillingClient; onBack: () => void }) {
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

      <section className="billing-empty" aria-label="Unsupported billing actions">
        <strong>Billing actions are disabled.</strong>
        <p>This screen does not create claims, invoices, billing runs, service authorizations, or financial transactions.</p>
      </section>
    </section>
  );
}
