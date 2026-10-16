"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { axisCareConnectionDisplay } from "@/domain/axiscare/status";
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
  waldahServiceType: string | null;
};
export type PendingMatch = { id: string; axisCareClientId: string; axisCareName: string; axisCareDateOfBirth: string | null; clientId: string; clientName: string; clientDateOfBirth: string | null; reason: string; score: number };
export type AxisCareConnectionView = { configured: boolean; baseUrl: string | null; status: string; lastTestedAt: string | null; lastConnectedAt: string | null; lastErrorCode: string | null; historyMonths: number };
type AxisCareAdministration = {
  connection: AxisCareConnectionView;
  caregivers: { externalId: string; firstName: string | null; lastName: string | null; employeeId: string | null }[];
  employees: { id: string; firstName: string; lastName: string; employeeNumber: string | null; axisCareCaregiverId: string | null }[];
  services: { axisCareServiceCode: string; waldahServiceType: string | null }[];
  syncStates: { entity: string; lastSuccessAt: string | null; lastError: string | null; lastCount: number }[];
  webhook: { enabled: false; reason: string };
};

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
          <span><small>Available to bill</small><b>Unavailable</b><em>Billing runs are disabled</em></span>
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

function AxisCareAdministrationPanel({ organizationId, initial }: { organizationId: string; initial: AxisCareConnectionView }) {
  const [admin, setAdmin] = useState<AxisCareAdministration | null>(null), [connection, setConnection] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [messageTone, setMessageTone] = useState<"good" | "warning" | "danger">("warning");
  async function request(path: string, init?: RequestInit) { const response = await fetch(`/api/organizations/${organizationId}/axiscare/${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }), body = await response.json(); if (!response.ok) throw new Error(body.error ?? "AxisCare request failed"); return body; }
  async function load() { try { const result = await request("connection"); setAdmin(result); setConnection(result.connection); } catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "AxisCare settings could not be loaded"); } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget, data = new FormData(form), token = String(data.get("apiToken") ?? "").trim();
    try {
      const result = await request("connection", { method: "PUT", body: JSON.stringify({ baseUrl: data.get("baseUrl"), ...(token ? { apiToken: token } : {}), historyMonths: Number(data.get("historyMonths")) }) });
      setConnection(result); const tokenInput = form.elements.namedItem("apiToken"); if (tokenInput instanceof HTMLInputElement) tokenInput.value = ""; setMessageTone("warning"); setMessage("Configuration saved. Test the connection before synchronization."); await load();
    } catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "Configuration was not saved"); } finally { setBusy(false); }
  }
  async function action(action: "TEST" | "SYNC") {
    setBusy(true); setMessage("");
    try {
      const result = await request("connection", { method: "POST", body: JSON.stringify({ action }) });
      if (action === "TEST") {
        setConnection(result);
        const display = axisCareConnectionDisplay(result.status);
        setMessageTone(result.status === "CONNECTED" ? "good" : result.status === "AUTHENTICATION_FAILED" ? "danger" : "warning");
        setMessage(result.status === "CONNECTED" ? "AxisCare connection verified successfully." : `${display.title} ${display.detail}`);
      } else {
        setMessageTone(result.failures?.length ? "danger" : "good");
        setMessage(result.failures?.length ? `Synchronization completed with failures: ${result.failures.join(", ")}.` : "Read-only synchronization completed. Review suggested client matches before linking anyone.");
      }
      await load();
    }
    catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "AxisCare operation failed"); } finally { setBusy(false); }
  }
  async function mapCaregiver(event: FormEvent<HTMLFormElement>, externalId: string) { event.preventDefault(); setBusy(true); try { const employeeId = new FormData(event.currentTarget).get("employeeId"); await request("mappings", { method: "POST", body: JSON.stringify({ kind: "CAREGIVER", externalId, employeeId }) }); setMessageTone("good"); setMessage("Caregiver mapping saved."); await load(); } catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "Caregiver mapping failed"); } finally { setBusy(false); } }
  async function mapService(event: FormEvent<HTMLFormElement>, axisCareServiceCode: string) { event.preventDefault(); setBusy(true); try { const waldahServiceType = new FormData(event.currentTarget).get("waldahServiceType"); await request("mappings", { method: "POST", body: JSON.stringify({ kind: "SERVICE", axisCareServiceCode, waldahServiceType }) }); setMessageTone("good"); setMessage("Service mapping saved."); await load(); } catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "Service mapping failed"); } finally { setBusy(false); } }
  return <details className="billing-integration-admin"><summary>AxisCare integration settings</summary><div className="billing-integration-body">
    <div className={`billing-connection-status ${axisCareConnectionDisplay(connection.status).tone}`} role="status">
      <span><strong>{axisCareConnectionDisplay(connection.status).title}</strong><small>{axisCareConnectionDisplay(connection.status).detail}</small></span>
      <StatusChip tone={axisCareConnectionDisplay(connection.status).tone}>{axisCareConnectionDisplay(connection.status).label}</StatusChip>
    </div>
    <p className="billing-muted">Credentials are encrypted server-side and are never returned to this screen. “Connected” appears only after a real authenticated API check.</p>
    <form className="settings-form compact" onSubmit={save}><label>AxisCare site URL<input name="baseUrl" type="url" required defaultValue={connection.baseUrl ?? "https://10461.axiscare.com"} /></label><label>API bearer token<input name="apiToken" type="password" autoComplete="new-password" placeholder={connection.configured ? "Leave blank to keep current token" : "Required"} required={!connection.configured} /></label><label>Visit history months<input name="historyMonths" type="number" min="1" max="60" defaultValue={connection.historyMonths} required /></label><button disabled={busy}>Save configuration</button></form>
    <p className="billing-muted">Synchronization stores a tenant-scoped read-only mirror and creates match suggestions. It does not create Waldah clients or change client profile fields.</p>
    <div className="billing-actions"><button type="button" className="secondary" disabled={busy || !connection.configured} onClick={() => void action("TEST")}>Test connection</button><button type="button" disabled={busy || connection.status !== "CONNECTED"} onClick={() => void action("SYNC")}>Synchronize now</button></div>
    {message ? <p role={messageTone === "danger" ? "alert" : "status"} className={`billing-feedback ${messageTone}`}>{message}</p> : null}
    {admin ? <><h3>Explicit mappings</h3><p className="billing-muted">Waldah never merges people by name alone. Confirm caregiver and service mappings explicitly.</p>
      <div className="billing-mapping-list">{admin.caregivers.map(caregiver => <form key={caregiver.externalId} onSubmit={event => mapCaregiver(event, caregiver.externalId)}><span><strong>{[caregiver.firstName, caregiver.lastName].filter(Boolean).join(" ") || `AxisCare caregiver ${caregiver.externalId}`}</strong><small>AxisCare ID {caregiver.externalId}</small></span><select name="employeeId" defaultValue={caregiver.employeeId ?? ""} required disabled={Boolean(caregiver.employeeId)}><option value="">Select Waldah employee</option>{admin.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.lastName}, {employee.firstName}{employee.employeeNumber ? ` · ${employee.employeeNumber}` : ""}</option>)}</select><button disabled={busy || Boolean(caregiver.employeeId)}>{caregiver.employeeId ? "Mapped" : "Map"}</button></form>)}</div>
      <div className="billing-mapping-list">{admin.services.map(service => <form key={service.axisCareServiceCode} onSubmit={event => mapService(event, service.axisCareServiceCode)}><span><strong>{service.axisCareServiceCode}</strong><small>AxisCare service code</small></span><input name="waldahServiceType" defaultValue={service.waldahServiceType ?? ""} placeholder="Waldah service type" required /><button disabled={busy}>Save mapping</button></form>)}</div>
      <p className="billing-note">Webhook intake disabled: {admin.webhook.reason}</p></> : null}
  </div></details>;
}

export default function BillingPortal({ clients, canRun = false, canManageIntegration = false, visits = [], matches = [], organizationId = "", connection }: { clients: BillingClient[]; canRun?: boolean; canManageIntegration?: boolean; visits?: BillingVisitRow[]; matches?: PendingMatch[]; organizationId?: string; connection: AxisCareConnectionView }) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => clients.filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase())), [clients, search]);
  const open = openId ? clients.find(client => client.id === openId) ?? null : null;
  const authorizationCount = clients.filter(client => client.approvedHours !== null).length;
  const connectionDisplay = axisCareConnectionDisplay(connection.status);

  return (
    <main className="admin-shell billing-shell" aria-label="Organization billing workspace">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Records</p>
          <h1>Billing</h1>
          <p className="lede">Review client service-period context while billing integrations remain safely unavailable.</p>
        </div>
      </header>

      <section className={`billing-banner connection-${connectionDisplay.tone}`} role="status">
        <div>
          <strong>{canManageIntegration ? connectionDisplay.title : connection.status === "CONNECTED" ? "AxisCare is connected for read-only synchronization." : canRun ? "AxisCare visit synchronization is not connected." : "You can view billed amounts. Billing is limited to billing roles."}</strong>
          <p>{canManageIntegration ? connectionDisplay.detail : "No claims, invoices, or billing runs can be submitted or changed from this screen."}</p>
        </div>
        <button type="button" className="secondary" disabled aria-disabled="true">Billing actions unavailable</button>
      </section>

      {canManageIntegration ? <AxisCareAdministrationPanel organizationId={organizationId} initial={connection} /> : null}

      {canRun ? <MatchReview matches={matches} organizationId={organizationId} /> : null}

      {!open ? (
        <>
          <section className="billing-stats" aria-label="Billing workspace status">
            <p className="billing-stat"><span>Clients</span><strong>{clients.length}</strong><small>Current organization only</small></p>
            <p className="billing-stat"><span>Service authorizations</span><strong>{authorizationCount}</strong><small>Clients with approved hours recorded</small></p>
            <p className={connection.status === "CONNECTED" ? "billing-stat" : "billing-stat warning"}><span>Visit feed</span><strong>{connection.status === "CONNECTED" ? "Connected" : pretty(connection.status)}</strong><small>{connection.lastConnectedAt ? `Last verified ${stamp(connection.lastConnectedAt)}` : "No verified connection"}</small></p>
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
              <td data-label="Visit">{stamp(visit.startAt)}<small>{visit.waldahServiceType ?? visit.serviceCode ?? "No service type"}{visit.serviceCode && visit.waldahServiceType ? ` · AxisCare ${visit.serviceCode}` : ""}</small></td>
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
        <p className="billing-stat warning"><span>Billable visits</span><strong>Not calculated</strong><small>Billing runs are disabled</small></p>
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
