"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { day, pretty, type PendingMatch } from "./billing-shared";

const PAGE_SIZE = 25;
type LifecycleFilter = "ACTIVE" | "INACTIVE" | "DISCHARGED" | "ARCHIVED" | "UNKNOWN" | "ALL";
type MatchFilter = "NEEDS_REVIEW" | "SUGGESTED" | "AMBIGUOUS" | "UNMATCHED" | "CONFIRMED" | "IGNORED" | "ALL";
type DispositionResult = { axisCareClientId: string; status: "IGNORED" | "RESTORED" | "ALREADY_IGNORED" | "ALREADY_ACTIVE" | "BLOCKED_CONFIRMED" | "NOT_FOUND" };

const needsReview = (row: PendingMatch) => row.state === "SUGGESTED" || row.state === "AMBIGUOUS" || row.state === "UNMATCHED";
const tone = (value: string) => value === "ACTIVE" || value === "CONFIRMED" ? "good" as const : value === "SUGGESTED" || value === "AMBIGUOUS" || value === "UNKNOWN" ? "warning" as const : "neutral" as const;

export default function MatchReview({ matches, organizationId }: { matches: PendingMatch[]; organizationId: string }) {
  const [rows, setRows] = useState(matches);
  const [selectedClients, setSelectedClients] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { tone: "good" | "danger"; text: string }>>({});
  const [message, setMessage] = useState<{ tone: "good" | "warning" | "danger"; text: string } | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("ACTIVE");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("NEEDS_REVIEW");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const counts = useMemo(() => ({
    active: rows.filter(row => row.axisCareLifecycle === "ACTIVE").length,
    inactive: rows.filter(row => ["INACTIVE", "DISCHARGED", "ARCHIVED"].includes(row.axisCareLifecycle)).length,
    needsReview: rows.filter(needsReview).length,
    confirmed: rows.filter(row => row.state === "CONFIRMED").length,
    ignored: rows.filter(row => row.state === "IGNORED").length,
  }), [rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const lifecycleMatches = lifecycleFilter === "ALL" || row.axisCareLifecycle === lifecycleFilter;
    const matchMatches = matchFilter === "ALL" ? true : matchFilter === "NEEDS_REVIEW" ? needsReview(row) : row.state === matchFilter;
    return lifecycleMatches && matchMatches && row.axisCareName.toLowerCase().includes(search.trim().toLowerCase());
  }), [rows, lifecycleFilter, matchFilter, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const eligibleVisible = visible.filter(needsReview);
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every(row => selected.has(row.axisCareClientId));

  useEffect(() => { setPage(1); setSelected(new Set()); }, [lifecycleFilter, matchFilter, search]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function request(body: object) {
    const response = await fetch(`/api/organizations/${organizationId}/axiscare/matches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "AxisCare client review could not be saved");
    return value;
  }
  function afterRestore(row: PendingMatch) { return row.candidates.length === 0 ? "UNMATCHED" as const : row.candidates.length === 1 ? "SUGGESTED" as const : "AMBIGUOUS" as const; }
  function applyDisposition(results: DispositionResult[]) {
    const statuses = new Map(results.map(result => [result.axisCareClientId, result.status]));
    setRows(current => current.map(row => statuses.get(row.axisCareClientId) === "IGNORED" ? { ...row, state: "IGNORED" } : statuses.get(row.axisCareClientId) === "RESTORED" ? { ...row, state: afterRestore(row) } : row));
  }
  async function setDisposition(row: PendingMatch, action: "IGNORE" | "RESTORE") {
    setBusy(row.axisCareClientId); setMessage(null);
    try {
      const body = await request({ action, axisCareClientIds: [row.axisCareClientId] }) as { results: DispositionResult[] };
      applyDisposition(body.results);
      const result = body.results[0];
      const text = result?.status === "IGNORED" ? "Ignored. This source client is excluded from synchronization." : result?.status === "RESTORED" ? "Restored to client matching. A match still requires confirmation." : result?.status === "BLOCKED_CONFIRMED" ? "A confirmed mapping must be handled separately before this client can be ignored." : "No change was needed.";
      if (result?.status === "IGNORED" || result?.status === "RESTORED") setMessage({ tone: "good", text });
      else setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: result?.status === "BLOCKED_CONFIRMED" ? "danger" : "good", text } }));
    } catch (error) { setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "danger", text: error instanceof Error ? error.message : "The decision could not be saved." } })); }
    finally { setBusy(null); }
  }
  async function bulkIgnore() {
    const ids = visible.filter(row => selected.has(row.axisCareClientId) && needsReview(row)).map(row => row.axisCareClientId);
    if (!ids.length || !window.confirm(`Ignore ${ids.length} selected AxisCare client${ids.length === 1 ? "" : "s"}? They will be excluded from synchronization until restored.`)) return;
    setBusy("bulk"); setMessage(null);
    try {
      const body = await request({ action: "IGNORE", axisCareClientIds: ids }) as { results: DispositionResult[]; changed: number; requested: number };
      applyDisposition(body.results); setSelected(new Set());
      const failed = body.requested - body.changed;
      setMessage({ tone: failed ? "warning" : "good", text: `${body.changed} client${body.changed === 1 ? "" : "s"} ignored.${failed ? ` ${failed} could not be ignored.` : ""}` });
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Selected clients could not be ignored." }); }
    finally { setBusy(null); }
  }
  async function createClientFrom(row: PendingMatch) {
    if (row.state !== "UNMATCHED" || row.candidates.length) return;
    if (!window.confirm(`Review and confirm creation of a new Waldah client for ${row.axisCareName}${row.axisCareDateOfBirth ? ` (born ${day(row.axisCareDateOfBirth)})` : ""}. Only the displayed name and date of birth will be copied. The client will start intake incomplete and be matched to this AxisCare identity.`)) return;
    setBusy(row.axisCareClientId);
    try {
      await request({ action: "CREATE_CLIENT", axisCareClientId: row.axisCareClientId });
      setRows(current => current.map(item => item.axisCareClientId === row.axisCareClientId ? { ...item, state: "CONFIRMED", confirmedClientName: row.axisCareName, availableClients: [] } : item));
      setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "good", text: "Client created and matched." } }));
    } catch (error) { setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "danger", text: error instanceof Error ? error.message : "Client was not created." } })); }
    finally { setBusy(null); }
  }
  async function linkSelected(row: PendingMatch) {
    const clientId = selectedClients[row.axisCareClientId] ?? (row.candidates.length === 1 ? row.candidates[0].clientId : "");
    if (!clientId) { setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "danger", text: "Select the Waldah client after reviewing both records." } })); return; }
    setBusy(row.axisCareClientId);
    try {
      await request({ axisCareClientId: row.axisCareClientId, clientId });
      const clientName = row.availableClients.find(client => client.id === clientId)?.name ?? null;
      setRows(current => current.map(item => item.axisCareClientId === row.axisCareClientId ? { ...item, state: "CONFIRMED", confirmedClientName: clientName, availableClients: [] } : item));
      setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "good", text: "Match confirmed." } }));
    } catch (error) { setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "danger", text: error instanceof Error ? error.message : "Match was not saved." } })); }
    finally { setBusy(null); }
  }
  async function rejectSuggestion(row: PendingMatch) {
    const matchId = row.candidates.length === 1 ? row.candidates[0].id : null;
    if (!matchId) return;
    setBusy(row.axisCareClientId);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/axiscare/matches/${matchId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "REJECT" }) });
      if (!response.ok) throw new Error("Suggestion could not be rejected");
      setRows(current => current.map(item => item.axisCareClientId === row.axisCareClientId ? { ...item, state: "UNMATCHED", candidates: [] } : item));
      setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "good", text: "Suggestion rejected. The source client remains unmatched." } }));
    } catch (error) { setFeedback(current => ({ ...current, [row.axisCareClientId]: { tone: "danger", text: error instanceof Error ? error.message : "Suggestion could not be rejected." } })); }
    finally { setBusy(null); }
  }
  function toggleVisible() {
    setSelected(current => {
      const next = new Set(current);
      for (const row of eligibleVisible) if (allVisibleSelected) next.delete(row.axisCareClientId); else next.add(row.axisCareClientId);
      return next;
    });
  }

  if (matches.length === 0) return null;
  return (
    <section className="billing-review" aria-label="AxisCare client matching management">
      <div className="billing-match-heading"><div><strong>AxisCare client matching</strong><p className="billing-muted">Review active clients first. Lifecycle status and matching decisions are tracked separately.</p></div><div className="billing-match-counts" aria-label="AxisCare client counts"><span><b>{counts.active}</b> active</span><span><b>{counts.inactive}</b> inactive</span><span><b>{counts.needsReview}</b> need review</span><span><b>{counts.confirmed}</b> confirmed</span><span><b>{counts.ignored}</b> ignored</span></div></div>
      <div className="billing-match-filters">
        <label>Search<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search AxisCare clients" /></label>
        <label>AxisCare status<select value={lifecycleFilter} onChange={event => setLifecycleFilter(event.target.value as LifecycleFilter)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="DISCHARGED">Discharged</option><option value="ARCHIVED">Archived</option><option value="UNKNOWN">Unknown</option><option value="ALL">All statuses</option></select></label>
        <label>Matching status<select value={matchFilter} onChange={event => setMatchFilter(event.target.value as MatchFilter)}><option value="NEEDS_REVIEW">Needs review</option><option value="SUGGESTED">Suggested</option><option value="AMBIGUOUS">Ambiguous</option><option value="UNMATCHED">Unmatched</option><option value="CONFIRMED">Confirmed</option><option value="IGNORED">Ignored</option><option value="ALL">All matching states</option></select></label>
      </div>
      {selected.size ? <div className="billing-group-bar"><strong>{selected.size} selected</strong><span className="billing-group-actions"><button type="button" disabled={busy === "bulk"} onClick={() => void bulkIgnore()}>{busy === "bulk" ? "Ignoring…" : "Ignore selected"}</button><button type="button" className="secondary" onClick={() => setSelected(new Set())}>Clear selection</button></span></div> : null}
      {message ? <p className={`billing-feedback ${message.tone}`} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</p> : null}
      <div className="billing-table-wrap">
        <table className="billing-table billing-match-table">
          <thead><tr><th><input type="checkbox" aria-label="Select visible clients" checked={allVisibleSelected} disabled={!eligibleVisible.length} onChange={toggleVisible} /></th><th>AxisCare client</th><th>AxisCare status</th><th>Matching status</th><th>Waldah client</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map(row => {
            const selectedClient = selectedClients[row.axisCareClientId] ?? (row.candidates.length === 1 ? row.candidates[0].clientId : "");
            const canReview = needsReview(row);
            return <tr key={row.axisCareClientId} className={selected.has(row.axisCareClientId) ? "billing-row-selected" : undefined}>
              <td data-label="Select"><input type="checkbox" aria-label={`Select ${row.axisCareName}`} checked={selected.has(row.axisCareClientId)} disabled={!canReview} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(row.axisCareClientId)) next.delete(row.axisCareClientId); else next.add(row.axisCareClientId); return next; })} /></td>
              <td data-label="AxisCare client"><strong>{row.axisCareName}</strong><small>{row.axisCareDateOfBirth ? `Born ${day(row.axisCareDateOfBirth)}` : "No date of birth"}</small></td>
              <td data-label="AxisCare status"><StatusChip tone={tone(row.axisCareLifecycle)}>{pretty(row.axisCareLifecycle)}</StatusChip><small>{row.axisCareStatusLabel ?? "Status unavailable"}</small></td>
              <td data-label="Matching status"><StatusChip tone={tone(row.state)}>{pretty(row.state)}</StatusChip>{row.candidates.map(candidate => <small key={candidate.id}>{candidate.clientName} · {candidate.reason}</small>)}</td>
              <td data-label="Waldah client">{row.state === "CONFIRMED" ? <strong>{row.confirmedClientName ?? "Confirmed client"}</strong> : row.state === "IGNORED" ? <span className="billing-muted">Restore before matching</span> : <select aria-label={`Waldah client for ${row.axisCareName}`} value={selectedClient} onChange={event => setSelectedClients(current => ({ ...current, [row.axisCareClientId]: event.target.value }))}><option value="">Select after identity review</option>{row.availableClients.map(client => <option key={client.id} value={client.id}>{client.name}{client.dateOfBirth ? ` · born ${day(client.dateOfBirth)}` : ""}</option>)}</select>}</td>
              <td data-label="Actions"><span className="billing-actions">{canReview ? <><button type="button" disabled={busy === row.axisCareClientId} onClick={() => void linkSelected(row)}>Confirm match</button>{row.state === "UNMATCHED" && row.candidates.length === 0 ? <button type="button" className="secondary" disabled={busy === row.axisCareClientId} onClick={() => void createClientFrom(row)}>Create client</button> : null}<button type="button" className="secondary" disabled={busy === row.axisCareClientId} onClick={() => void setDisposition(row, "IGNORE")}>Ignore</button>{row.candidates.length === 1 ? <button type="button" className="secondary" disabled={busy === row.axisCareClientId} onClick={() => void rejectSuggestion(row)}>Reject suggestion</button> : null}</> : row.state === "IGNORED" ? <button type="button" className="secondary" disabled={busy === row.axisCareClientId} onClick={() => void setDisposition(row, "RESTORE")}>Restore</button> : null}</span>{feedback[row.axisCareClientId] ? <small className={`billing-inline-feedback ${feedback[row.axisCareClientId].tone}`} role={feedback[row.axisCareClientId].tone === "danger" ? "alert" : "status"}>{feedback[row.axisCareClientId].text}</small> : null}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!visible.length ? <p className="billing-empty">No AxisCare clients match these filters. Unknown-status and ignored clients remain available through the filters.</p> : null}
      <div className="billing-pagination"><span>Showing {visible.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span><span><button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className="secondary" disabled={page === pageCount} onClick={() => setPage(value => value + 1)}>Next</button></span></div>
    </section>
  );
}
