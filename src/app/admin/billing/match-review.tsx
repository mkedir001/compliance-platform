"use client";

import { useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { day, type PendingMatch } from "./billing-shared";

export default function MatchReview({ matches, organizationId }: { matches: PendingMatch[]; organizationId: string }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = matches.filter(match => !done[match.axisCareClientId]);
  if (matches.length === 0) return null;
  async function decide(match: PendingMatch, matchId: string, action: "CONFIRM" | "REJECT") {
    setBusy(match.axisCareClientId); setError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/axiscare/matches/${matchId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error("not saved");
      if(action === "CONFIRM") setDone(current => ({ ...current, [match.axisCareClientId]: "Linked" })); else window.location.reload();
    } catch { setError("That could not be saved. Try again."); } finally { setBusy(null); }
  }
  async function linkSelected(match: PendingMatch) {
    const clientId=selected[match.axisCareClientId]??(match.candidates.length===1?match.candidates[0].clientId:""); if(!clientId){setError("Select the Waldah client after reviewing both records.");return}
    setBusy(match.axisCareClientId);setError(null);
    try{const response=await fetch(`/api/organizations/${organizationId}/axiscare/matches`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({axisCareClientId:match.axisCareClientId,clientId})});const body=await response.json();if(!response.ok)throw new Error(body.error??"Match was not saved");setDone(current=>({...current,[match.axisCareClientId]:"Linked"}))}catch(error){setError(error instanceof Error?error.message:"Match was not saved")}finally{setBusy(null)}
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
          <thead><tr><th>AxisCare client</th><th>Candidate review</th><th>Explicit selection</th><th><span className="sr-only">Decision</span></th></tr></thead>
          <tbody>{matches.map(match => (
            <tr key={match.axisCareClientId}>
              <td data-label="AxisCare client">{match.axisCareName}<small>{match.axisCareDateOfBirth ? `Born ${day(match.axisCareDateOfBirth)}` : "No date of birth"}</small></td>
              <td data-label="Candidate review"><StatusChip tone={match.state==="SUGGESTED"?"warning":"neutral"}>{match.state.toLowerCase()}</StatusChip>{match.candidates.map(candidate=><small key={candidate.id}>{candidate.clientName} · {candidate.reason}</small>)}</td>
              <td data-label="Explicit selection"><select aria-label={`Waldah client for ${match.axisCareName}`} value={selected[match.axisCareClientId]??(match.candidates.length===1?match.candidates[0].clientId:"")} onChange={event=>setSelected(current=>({...current,[match.axisCareClientId]:event.target.value}))}><option value="">Select after identity review</option>{match.availableClients.map(client=><option key={client.id} value={client.id}>{client.name}{client.dateOfBirth?` · born ${day(client.dateOfBirth)}`:""}</option>)}</select></td>
              <td data-label="Decision">{done[match.axisCareClientId] ? <StatusChip tone={done[match.axisCareClientId] === "Linked" ? "good" : "neutral"}>{done[match.axisCareClientId]}</StatusChip> : (
                <span className="billing-actions">
                  <button type="button" disabled={busy === match.axisCareClientId} onClick={() => void linkSelected(match)}>Confirm selected match</button>
                  {match.candidates.length===1?<button type="button" className="secondary" disabled={busy === match.axisCareClientId} onClick={() => decide(match, match.candidates[0].id, "REJECT")}>Reject suggestion</button>:null}
                </span>)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}
