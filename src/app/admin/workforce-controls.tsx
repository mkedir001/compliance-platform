"use client";

import { FormEvent, useEffect, useState } from "react";
import { ActionFeedback, Drawer, useAsyncAction } from "@/app/components/portal-ui";

type Role = { id: string; code: string; name: string };
type Props = { userId: string; organizationId: string; employeeId: string; employmentStatus: string; invitation: { id: string; status: string; deliveryStatus?: string; deliveryAttempts?: number; deliveryProvider?: string | null; providerAcceptedAt?: string | null; deliveryErrorCode?: string | null } | null; organizationAccess: { status: string; roles: Role[] } | null; onChanged: () => void };
const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ");

export default function WorkforceControls({ userId, organizationId, employeeId, employmentStatus, invitation, organizationAccess, onChanged }: Props) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const action = useAsyncAction();
  const headers = { "content-type": "application/json", "x-dev-user-id": userId };
  async function request(path: string, init?: RequestInit) { const response = await fetch(`/api/organizations/${organizationId}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }), body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Administrative action failed"); return body; }
  useEffect(() => { if (!userId || !organizationId) return; const controller = new AbortController(); void fetch(`/api/organizations/${organizationId}/admin/roles`, { headers: { "x-dev-user-id": userId }, signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); }).then(setRoles).catch(() => { if (!controller.signal.aborted) setRoles([]); }); return () => controller.abort(); }, [userId, organizationId]);
  async function run(work: () => Promise<unknown>, success: string, closeDrawer = false) { const completed = await action.execute(work, success); if (completed) { if (closeDrawer) setDrawerOpen(false); await onChanged(); } }
  function lifecycle(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget), status = String(data.get("status")), effectiveDate = data.get("effectiveDate") || undefined, reasonChoice = String(data.get("reasonChoice")), note = String(data.get("note") ?? "").trim(), reason = note ? `${reasonChoice}: ${note}` : reasonChoice; void run(() => request(`/admin/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify({ action: "TRANSITION_LIFECYCLE", input: { status, effectiveDate, reason } }) }), "Workforce status updated and operational safeguards applied.", true); }
  function correction(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget), input = Object.fromEntries([...data.entries()].filter(([, value]) => String(value).trim())); void run(() => request(`/admin/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify({ action: "CORRECT_ADMINISTRATION", input }) }), "Administrative correction recorded with an audit reason."); }
  function access(enabled: boolean) { const reason = window.prompt(`Reason to ${enabled ? "restore" : "disable"} organizational access`); if (reason) void run(() => request(`/employees/${employeeId}/portal-access`, { method: "PATCH", body: JSON.stringify({ enabled, reason }) }), `Organizational access ${enabled ? "restored" : "disabled"}.`); }
  function revoke() { const reason = window.prompt("Reason to revoke this unused invitation"); if (reason && invitation) void run(() => request(`/employees/${employeeId}/portal-access`, { method: "DELETE", body: JSON.stringify({ invitationId: invitation.id, reason }) }), "Unused invitation revoked. No token was exposed."); }
  function role(roleDefinitionId: string, operation: "GRANT" | "REVOKE") { void run(() => request(`/admin/employees/${employeeId}/roles`, { method: "POST", body: JSON.stringify({ roleDefinitionId, action: operation }) }), `Organization role ${operation.toLowerCase()} recorded.`); }
  const pending = action.state === "pending";
  return <section aria-labelledby="workforce-controls">
    <div className="section-heading"><div><h3 id="workforce-controls">Workforce administration</h3><p>Employment, account access, and compliance state remain separate.</p></div><button type="button" onClick={() => { action.reset(); setDrawerOpen(true); }}>Change workforce status</button></div>
    <ActionFeedback state={action.state} message={action.message} />
    <Drawer open={drawerOpen} title="Change workforce status" onClose={() => !pending && setDrawerOpen(false)}>
      <form onSubmit={lifecycle} aria-busy={pending}>
        <label>Current status<input value={pretty(employmentStatus)} disabled /></label>
        <fieldset className="lifecycle-options"><legend>New status</legend>
          <label className="lifecycle-option"><input type="radio" name="status" value="ACTIVE" required /><strong>Active</strong><small>Employee can participate in ordinary workforce operations.</small></label>
          <label className="lifecycle-option"><input type="radio" name="status" value="LEAVE" /><strong>Leave / inactive</strong><small>Preserves the record while applying existing access and assignment safeguards.</small></label>
          <label className="lifecycle-option"><input type="radio" name="status" value="TERMINATED" /><strong>Terminated / separated</strong><small>Preserves history and applies the existing separation safeguards.</small></label>
        </fieldset>
        <label>Effective date<input name="effectiveDate" type="date" /></label>
        <label>Reason<select name="reasonChoice" required defaultValue=""><option value="" disabled>Select a reason</option><option>Hired</option><option>Rehired</option><option>Returned from leave</option><option>Other</option></select></label>
        <label>Audit note (optional)<textarea name="note" rows={3} /></label>
        <p className="drawer-note"><strong>What this change does</strong><br />Uses the existing audited lifecycle workflow. It does not create training completion, competency, clinical authority, or medication authorization.</p>
        <ActionFeedback state={action.state} message={action.message} />
        <div className="drawer-actions"><button type="button" className="secondary" disabled={pending} onClick={() => setDrawerOpen(false)}>Cancel</button><button disabled={pending}>{pending ? "Updating status…" : "Confirm change"}</button></div>
      </form>
    </Drawer>
    <details><summary>Edit employee details</summary><form className="inline-form" onSubmit={correction} aria-busy={pending}><label>First name<input name="firstName" /></label><label>Last name<input name="lastName" /></label><label>Employee number<input name="employeeNumber" /></label><label>Email<input name="email" type="email" /></label><label>Hire date<input name="hireDate" type="date" /></label><label>Correction reason<input name="reason" minLength={3} required /></label><button disabled={pending}>{pending ? "Saving…" : "Save details"}</button></form></details>
    <article><h4>Portal access</h4><p>{organizationAccess ? `Organization access: ${pretty(organizationAccess.status)}` : "No linked organization account"} · {invitation ? `Invitation: ${pretty(invitation.status)} · ${invitation.status === "ACCEPTED" ? "claimed" : invitation.deliveryStatus === "ACCEPTED" ? "provider accepted (not delivery confirmed)" : invitation.deliveryStatus === "FAILED" ? "delivery failed" : "pending delivery"}` : "No invitation"}</p>{organizationAccess?.status === "ACTIVE" ? <button disabled={pending} onClick={() => access(false)}>Disable organization access</button> : organizationAccess && employmentStatus === "ACTIVE" ? <button disabled={pending} onClick={() => access(true)}>Restore organization access</button> : null}{invitation?.status === "PENDING" ? <button className="secondary" disabled={pending} onClick={revoke}>Revoke unused invitation</button> : null}</article>
    <article><h4>Access and roles</h4><p>Clinical and organization-owner roles are intentionally unavailable here.</p>{organizationAccess?.roles.map(item => <p key={item.id}>{item.name} <button disabled={pending} onClick={() => role(item.id, "REVOKE")}>Revoke</button></p>)}<label>Grant fixed role<select defaultValue="" disabled={pending} onChange={event => { if (event.target.value) { role(event.target.value, "GRANT"); event.target.value = ""; } }}><option value="">Select authorized role</option>{roles.filter(roleItem => !organizationAccess?.roles.some(current => current.id === roleItem.id)).map(roleItem => <option key={roleItem.id} value={roleItem.id}>{roleItem.name}</option>)}</select></label></article>
  </section>;
}
