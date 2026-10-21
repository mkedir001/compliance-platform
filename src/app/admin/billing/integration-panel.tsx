"use client";

import { FormEvent, useEffect, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { axisCareConnectionDisplay } from "@/domain/axiscare/status";
import { stamp, type AxisCareAdministration, type AxisCareConnectionView } from "./billing-shared";

export default function AxisCareAdministrationPanel({ organizationId, initial, canConfigure, canMap, canSync }: { organizationId: string; initial: AxisCareConnectionView; canConfigure: boolean; canMap: boolean; canSync: boolean }) {
  const [admin, setAdmin] = useState<AxisCareAdministration | null>(null), [connection, setConnection] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [messageTone, setMessageTone] = useState<"good" | "warning" | "danger">("warning");
  const [mappingBusy, setMappingBusy] = useState<string | null>(null), [mappingFeedback, setMappingFeedback] = useState<Record<string, { tone: "good" | "danger"; text: string }>>({});
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
        const links=result.links as {axisCareClients?:number;confirmed?:number;suggestedClients?:number;ambiguous?:number;unmatched?:number}|undefined;
        const failureDetails=result.failureDetails as {entity:string;category:string;retryable:boolean}[]|undefined;
        setMessage(result.failures?.length ? `Synchronization could not complete ${failureDetails?.map(item=>`${item.entity}: ${item.category.toLowerCase().replaceAll("_"," ")}${item.retryable?"; safe to retry":""}`).join("; ")??result.failures.join(", ")}. Existing staged records and mappings were preserved.` : `Read-only synchronization completed: ${links?.axisCareClients??0} AxisCare clients found, ${links?.confirmed??0} already linked, ${links?.suggestedClients??0} with suggested matches, ${links?.ambiguous??0} ambiguous, and ${links?.unmatched??0} needing manual review.`);
      }
      await load();
    }
    catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "AxisCare operation failed"); } finally { setBusy(false); }
  }
  async function mapCaregiver(event: FormEvent<HTMLFormElement>, externalId: string) { event.preventDefault(); setBusy(true); try { const employeeId = new FormData(event.currentTarget).get("employeeId"); await request("mappings", { method: "POST", body: JSON.stringify({ kind: "CAREGIVER", externalId, employeeId }) }); setMessageTone("good"); setMessage("Caregiver mapping saved."); await load(); } catch (error) { setMessageTone("danger"); setMessage(error instanceof Error ? error.message : "Caregiver mapping failed"); } finally { setBusy(false); } }
  async function mapService(event: FormEvent<HTMLFormElement>, axisCareServiceCode: string) { event.preventDefault(); setMappingBusy(axisCareServiceCode); setMappingFeedback(current=>({...current,[axisCareServiceCode]:{tone:"good",text:"Saving…"}})); try { const waldahServiceType = new FormData(event.currentTarget).get("waldahServiceType"); await request("mappings", { method: "POST", body: JSON.stringify({ kind: "SERVICE", axisCareServiceCode, waldahServiceType }) }); setMappingFeedback(current=>({...current,[axisCareServiceCode]:{tone:"good",text:"Mapping saved."}})); await load(); } catch (error) { setMappingFeedback(current=>({...current,[axisCareServiceCode]:{tone:"danger",text:error instanceof Error ? error.message : "Service mapping failed"}})); } finally { setMappingBusy(null); } }
  const display = axisCareConnectionDisplay(connection.status);
  const unmapped = admin ? admin.caregivers.filter(caregiver => !caregiver.employeeId).length : 0;
  return <details className="billing-integration-admin">
    <summary>
      <span className="billing-integration-title">AxisCare integration</span>
      <StatusChip tone={display.tone}>{display.label}</StatusChip>
      <small>{connection.lastConnectedAt ? `Last verified ${stamp(connection.lastConnectedAt)}` : display.detail}</small>
    </summary>
    <div className="billing-integration-body">
      {canConfigure ? <form className="billing-integration-form" onSubmit={save}><label>AxisCare site URL<input name="baseUrl" type="url" required defaultValue={connection.baseUrl ?? "https://10461.axiscare.com"} /></label><label>API bearer token<input name="apiToken" type="password" autoComplete="new-password" placeholder={connection.configured ? "Leave blank to keep current token" : "Required"} required={!connection.configured} /></label><label>Visit history months<input name="historyMonths" type="number" min="1" max="60" defaultValue={connection.historyMonths} required /></label><button disabled={busy}>Save</button></form> : null}
      <div className="billing-integration-actions">
        {canConfigure ? <button type="button" className="secondary" disabled={busy || !connection.configured} onClick={() => void action("TEST")}>Test connection</button> : null}
        {canSync ? <button type="button" disabled={busy || connection.status !== "CONNECTED"} onClick={() => void action("SYNC")}>Synchronize now</button> : null}
        <small className="billing-muted">Read-only. The token is encrypted and never shown again.</small>
      </div>
      {message ? <p role={messageTone === "danger" ? "alert" : "status"} className={`billing-feedback ${messageTone}`}>{message}</p> : null}
      {admin ? <>
        {canMap ? <><details className="billing-subpanel"><summary>Caregiver mappings{unmapped ? ` · ${unmapped} to map` : ""}</summary>
          <div className="billing-mapping-list">{admin.caregivers.map(caregiver => <form key={caregiver.externalId} onSubmit={event => mapCaregiver(event, caregiver.externalId)}><span><strong>{[caregiver.firstName, caregiver.lastName].filter(Boolean).join(" ") || `AxisCare caregiver ${caregiver.externalId}`}</strong><small>AxisCare ID {caregiver.externalId}</small></span><select name="employeeId" defaultValue={caregiver.employeeId ?? ""} required disabled={Boolean(caregiver.employeeId)}><option value="">Select Waldah employee</option>{admin.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.lastName}, {employee.firstName}{employee.employeeNumber ? ` · ${employee.employeeNumber}` : ""}</option>)}</select><button disabled={busy || Boolean(caregiver.employeeId)}>{caregiver.employeeId ? "Mapped" : "Map"}</button></form>)}</div>
        </details>
        <details className="billing-subpanel"><summary>Service mappings{admin.services.length ? ` · ${admin.services.length}` : ""}</summary>
          <div className="billing-mapping-list">{admin.services.map(service => <form key={`${service.axisCareServiceCode}:${service.waldahServiceType??"unmapped"}`} onSubmit={event => mapService(event, service.axisCareServiceCode)}><span><strong>{service.description??service.axisCareServiceCode}</strong><small>AxisCare code {service.axisCareServiceCode}{service.axisCareServiceId?` · ID ${service.axisCareServiceId}`:""}{service.procedureCode?` · procedure ${service.procedureCode}`:""} · {service.visitCount} visit{service.visitCount===1?"":"s"}</small></span><select name="waldahServiceType" defaultValue={service.waldahServiceType ?? ""} required><option value="">Select Waldah service type</option>{admin.serviceTargets.map(target=><option key={target.value} value={target.value}>{target.label}</option>)}</select><button disabled={mappingBusy===service.axisCareServiceCode}>{mappingBusy===service.axisCareServiceCode?"Saving…":service.waldahServiceType?"Update mapping":"Save mapping"}</button>{mappingFeedback[service.axisCareServiceCode]?<small role={mappingFeedback[service.axisCareServiceCode].tone==="danger"?"alert":"status"} className={`billing-feedback ${mappingFeedback[service.axisCareServiceCode].tone}`}>{mappingFeedback[service.axisCareServiceCode].text}</small>:null}</form>)}</div>
        </details></> : null}
        <p className="billing-muted">Webhooks off: {admin.webhook.reason}</p>
      </> : null}
    </div>
  </details>;
}
