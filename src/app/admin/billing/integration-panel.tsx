"use client";

import { FormEvent, useEffect, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { axisCareConnectionDisplay } from "@/domain/axiscare/status";
import { stamp, type AxisCareAdministration, type AxisCareConnectionView } from "./billing-shared";

export default function AxisCareAdministrationPanel({ organizationId, initial }: { organizationId: string; initial: AxisCareConnectionView }) {
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
  const display = axisCareConnectionDisplay(connection.status);
  const unmapped = admin ? admin.caregivers.filter(caregiver => !caregiver.employeeId).length : 0;
  return <details className="billing-integration-admin">
    <summary>
      <span className="billing-integration-title">AxisCare integration</span>
      <StatusChip tone={display.tone}>{display.label}</StatusChip>
      <small>{connection.lastConnectedAt ? `Last verified ${stamp(connection.lastConnectedAt)}` : display.detail}</small>
    </summary>
    <div className="billing-integration-body">
      <form className="billing-integration-form" onSubmit={save}><label>AxisCare site URL<input name="baseUrl" type="url" required defaultValue={connection.baseUrl ?? "https://10461.axiscare.com"} /></label><label>API bearer token<input name="apiToken" type="password" autoComplete="new-password" placeholder={connection.configured ? "Leave blank to keep current token" : "Required"} required={!connection.configured} /></label><label>Visit history months<input name="historyMonths" type="number" min="1" max="60" defaultValue={connection.historyMonths} required /></label><button disabled={busy}>Save</button></form>
      <div className="billing-integration-actions">
        <button type="button" className="secondary" disabled={busy || !connection.configured} onClick={() => void action("TEST")}>Test connection</button>
        <button type="button" disabled={busy || connection.status !== "CONNECTED"} onClick={() => void action("SYNC")}>Synchronize now</button>
        <small className="billing-muted">Read-only. The token is encrypted and never shown again.</small>
      </div>
      {message ? <p role={messageTone === "danger" ? "alert" : "status"} className={`billing-feedback ${messageTone}`}>{message}</p> : null}
      {admin ? <>
        <details className="billing-subpanel"><summary>Caregiver mappings{unmapped ? ` · ${unmapped} to map` : ""}</summary>
          <div className="billing-mapping-list">{admin.caregivers.map(caregiver => <form key={caregiver.externalId} onSubmit={event => mapCaregiver(event, caregiver.externalId)}><span><strong>{[caregiver.firstName, caregiver.lastName].filter(Boolean).join(" ") || `AxisCare caregiver ${caregiver.externalId}`}</strong><small>AxisCare ID {caregiver.externalId}</small></span><select name="employeeId" defaultValue={caregiver.employeeId ?? ""} required disabled={Boolean(caregiver.employeeId)}><option value="">Select Waldah employee</option>{admin.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.lastName}, {employee.firstName}{employee.employeeNumber ? ` · ${employee.employeeNumber}` : ""}</option>)}</select><button disabled={busy || Boolean(caregiver.employeeId)}>{caregiver.employeeId ? "Mapped" : "Map"}</button></form>)}</div>
        </details>
        <details className="billing-subpanel"><summary>Service mappings{admin.services.length ? ` · ${admin.services.length}` : ""}</summary>
          <div className="billing-mapping-list">{admin.services.map(service => <form key={service.axisCareServiceCode} onSubmit={event => mapService(event, service.axisCareServiceCode)}><span><strong>{service.axisCareServiceCode}</strong><small>AxisCare service code</small></span><input name="waldahServiceType" defaultValue={service.waldahServiceType ?? ""} placeholder="Waldah service type" required /><button disabled={busy}>Save mapping</button></form>)}</div>
        </details>
        <p className="billing-muted">Webhooks off: {admin.webhook.reason}</p>
      </> : null}
    </div>
  </details>;
}
