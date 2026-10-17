"use client";

import { useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { day, type PendingMatch } from "./billing-shared";

export default function MatchReview({ matches, organizationId }: { matches: PendingMatch[]; organizationId: string }) {
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