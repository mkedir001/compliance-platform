"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marRows, medicationActiveOn, timeLabel, UNSCHEDULED_TIME, type DoseStatus } from "@/domain/clients/mar";
import "./medication.css";

type Medication = { id: string; medication: string; dose: string | null; route: string | null; times: string | null; reason: string | null; prescriber: string | null; startDate: string | null; stopDate: string | null; marApproved: boolean; historicalApprovedFrom: string | null; historicalApprovedThrough: string | null };
type Dose = { id: string; medicationId: string; doseDate: string; scheduledTime: string; status: DoseStatus; timeGiven: string | null; note: string | null; signerUserId: string | null; signerName: string | null; signerInitials: string | null; signedAt: string; updatedAt: string; correctionReason: string | null; transferredFromPaper: boolean };
type Week = { weekStart: string; weekEnd: string; firstDay: string; lastDay: string; signoff: { signerName: string } | null };
type Staff = { userId: string; typedName: string; initials: string };
type HistoricalEntry = { id: string; batchId: string; medication: { medication: string; dose: string | null; route: string | null }; employee: { id: string; name: string; employmentStatus: string } | null; mine: boolean; doseDate: string; scheduledTime: string; reconstructionState: string; medicationAuthorizationState: string; matchState: string; confidence: string; attendanceSource: string; attendanceEvidenceKey: string | null; reviewState: string; paperStatus: DoseStatus | null; paperTimeGiven: string | null; paperNote: string | null; sourceReference: string | null; sourceDescription: string | null; sourceCaregiverSigned: boolean | null; sourceVerifiedAt: string | null; discrepancyCode: string | null; discrepancyNote: string | null; correctionReason: string | null; version: number; visit: { externalId: string; clockInAt: string | null; clockOutAt: string | null } | null; attestation: { signedAt: string; snapshotHash: string } | null };
type HistoricalCompleteness = { batchId: string; rangeStart: string; rangeEnd: string; expectedScheduledOccurrences: number; draftOccurrences: number; awaitingSourceReview: number; verifiedEntries: number; attestedEntries: number; missingAttendance: number; unresolvedCaregiverIdentities: number; conflictingAttendance: number; missingMedicationAuthorization: number; unresolvedAdministrationOutcomes: number; complete: boolean };
type HistoricalWorkspace = { enabled: boolean; canImport: boolean; canReconstruct?: boolean; canReview?: boolean; canCorrect?: boolean; canAttest?: boolean; statement: string; completeness?: HistoricalCompleteness[]; batches: { id: string; rangeStart: string; rangeEnd: string; status: string; summaryJson: unknown; createdAt: string }[]; entries: HistoricalEntry[] };
type MarData = {
  month: string; today: string;
  me: { userId: string; hasSignature: boolean; canRecord: boolean; canHistoricalReview: boolean; canSignWeek: boolean; isManager: boolean; canEditMedications: boolean; canProposeMedications: boolean; administrationBlockers: string[] };
  consent: { version: string; text: string };
  medications: Medication[]; doses: Dose[]; weeks: Week[]; staff: Staff[];
  historical: HistoricalWorkspace;
  admin: null | { summary: { given: number; refused: number; held: number; notGiven: number; notDocumented: number }; entries: { [id: string]: { enteredAt: string; signedAt: string; appliedBy: string | null; attestedInPerson: boolean; transferredFromPaper: boolean } }; history: { id: string; entityType: string; action: string; changedAt: string; changedBy: string; label: string }[] };
};
type Props = { organizationId: string; clientId: string; allergies?: string | null; headers: { [key: string]: string } };

const CELL: { [key in DoseStatus]: { text: string; css: string; name: string } } = {
  GIVEN: { text: "", css: "given", name: "Given" }, REFUSED: { text: "R", css: "refused", name: "Refused" },
  HELD: { text: "H", css: "held", name: "Held" }, NOT_GIVEN: { text: "N", css: "notgiven", name: "Not given" },
};
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (month: string, by: number) => { const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

type Target = { medication: Medication; time: string; day: string; existing: Dose | null };

export function MedicationPanel({ organizationId, clientId, allergies, headers }: Props) {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7));
  const [view, setView] = useState<"MAR" | "MEDICATIONS" | "HISTORICAL">("MAR");
  const [data, setData] = useState<MarData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [editing, setEditing] = useState<Medication | "new" | null>(null);
  const headersRef = useRef(headers); headersRef.current = headers;
  const base = `/api/organizations/${organizationId}/clients/${clientId}/medication`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${base}?month=${month}`, { headers: headersRef.current }), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the medication record");
      setData(body); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load the medication record"); }
  }, [base, month]);
  useEffect(() => { void load(); }, [load]);

  async function act(body: { [key: string]: unknown }) {
    setBusy(true); setError("");
    try {
      const response = await fetch(base, { method: "POST", headers: headersRef.current, body: JSON.stringify(body) }), result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save");
      await load(); return result as Record<string, unknown>;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save"); return null; }
    finally { setBusy(false); }
  }

  const days = useMemo(() => { const [y, m] = month.split("-").map(Number), count = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`); }, [month]);
  const rows = useMemo(() => (data ? marRows(data.medications.filter(m => days.some(day => medicationActiveOn(m, day)) || data.doses.some(d => d.medicationId === m.id)), data.doses) : []), [data, days]);
  const doseAt = (medicationId: string, day: string, time: string) => data?.doses.find(d => d.medicationId === medicationId && d.doseDate === day && d.scheduledTime === time) ?? null;

  if (!data) return <section className="med-shell" aria-label="Medication"><h3>Medication</h3>{error ? <p className="med-error" role="alert">{error}</p> : <p>Loading…</p>}</section>;
  const { me, admin } = data;
  const rowSpanFor = (id: string, index: number) => (index > 0 && rows[index - 1].medicationId === id ? 0 : rows.filter(r => r.medicationId === id).length);

  return <section className="med-shell" aria-label="Medication">
    <div className="med-bar">
      <div><h3 style={{ margin: 0 }}>Medication</h3>{allergies ? <p className="med-note" style={{ margin: "2px 0 0" }}><b>Allergies:</b> {allergies}</p> : null}</div>
      <div className="med-month med-noprint">
        <button type="button" className="secondary" onClick={() => setMonth(shiftMonth(month, -1))}>‹ {monthLabel(shiftMonth(month, -1)).split(" ")[0]}</button>
        <input type="month" aria-label="Month" value={month} max={data.today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} />
        <button type="button" className="secondary" disabled={month >= data.today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>{monthLabel(shiftMonth(month, 1)).split(" ")[0]} ›</button>
        <button type="button" className="secondary" onClick={() => window.print()}>Print / PDF</button>
      </div>
    </div>
    <div className="med-sub med-noprint"><button type="button" className={view === "MAR" ? "on" : ""} onClick={() => setView("MAR")}>MAR</button><button type="button" className={view === "MEDICATIONS" ? "on" : ""} onClick={() => setView("MEDICATIONS")}>Medications</button>{data.historical.enabled ? <button type="button" className={view === "HISTORICAL" ? "on" : ""} onClick={() => setView("HISTORICAL")}>Historical review</button> : null}</div>
    {error ? <p className="med-error" role="alert">{error}</p> : null}

    {(me.canRecord || me.canSignWeek || me.canHistoricalReview) && !me.hasSignature ? <SignatureSetup consent={data.consent.text} busy={busy} onSave={name => act({ action: "SETUP_SIGNATURE", typedName: name, consent: true })} /> : null}
    {!me.canRecord && me.administrationBlockers.length ? <p className="med-note med-noprint">Administration documentation is unavailable until the assigned employee&apos;s current medication qualification, person-specific instruction, authorization, and active client assignment are all satisfied.</p> : null}

    {view === "MEDICATIONS" ? <MedicationList data={data} editing={editing} setEditing={setEditing} busy={busy} onSave={async value => { if (await act({ action: "SAVE_MEDICATION", ...value })) setEditing(null); }} onApprove={id => void act({ action: "APPROVE_MEDICATION", id })} onHistoricalApprove={value => void act({ action: "APPROVE_HISTORICAL_MEDICATION", ...value })} /> : view === "HISTORICAL" ? <HistoricalMarPanel data={data} busy={busy} act={act} clientId={clientId} /> : <>
      <h4 style={{ margin: 0 }}>{monthLabel(month)}</h4>
      {rows.length ? <div className="med-scroll"><table className="med-grid" aria-label={`MAR for ${monthLabel(month)}`}>
        <thead><tr><th className="med-name">Medication · dose · route</th><th className="med-time">Time</th>{days.map(day => <th key={day}>{Number(day.slice(8))}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const medication = data.medications.find(m => m.id === row.medicationId)!, span = rowSpanFor(row.medicationId, index);
          return <tr key={`${row.medicationId}|${row.time}`}>
            {span ? <td className="med-name" rowSpan={span}><strong>{medication.medication}{medication.dose ? ` ${medication.dose}` : ""}</strong><small>{[medication.route, medication.reason, medication.prescriber].filter(Boolean).join(" · ")}{medication.stopDate && medication.stopDate < data.today ? ` · stopped ${shortDay(medication.stopDate)}` : ""}</small></td> : null}
            <td className="med-time">{timeLabel(row.time)}</td>
            {days.map(day => {
              const dose = doseAt(row.medicationId, day, row.time), future = day > data.today, inactive = !dose && !medicationActiveOn(medication, day);
              if (inactive) return <td key={day} style={{ background: "#efede6" }} />;
              const info = dose ? CELL[dose.status] : null, text = dose ? (dose.status === "GIVEN" ? dose.signerInitials ?? "✓" : info!.text) : "";
              return <td key={day}><button type="button" disabled={future || !me.canRecord || !medication.marApproved || row.time === UNSCHEDULED_TIME || Boolean(dose?.transferredFromPaper)} className={`med-cell ${info?.css ?? ""} ${dose?.transferredFromPaper ? "historical" : ""} ${future ? "future" : ""} ${day === data.today ? "today" : ""}`} aria-label={`${medication.medication} ${timeLabel(row.time)} ${longDay(day)}${dose ? `, ${info!.name}${dose.signerName ? ` by ${dose.signerName}` : ""}${dose.transferredFromPaper ? ", historical paper MAR verified electronically later" : ""}` : ", no entry"}`} title={!medication.marApproved ? "This medication has not been explicitly approved for MAR documentation" : row.time === UNSCHEDULED_TIME ? "PRN or unstructured schedules require a governed workflow and cannot be recorded here" : dose ? `${info!.name}${dose.signerName ? ` · ${dose.signerName}` : ""}${dose.timeGiven ? ` · ${timeLabel(dose.timeGiven)}` : ""}${dose.note ? ` · ${dose.note}` : ""}${dose.transferredFromPaper ? ` · historical paper MAR · electronically verified ${new Date(dose.signedAt).toLocaleString()} · corrections require re-attestation in Historical review` : ""}` : ""} onClick={() => setTarget({ medication, time: row.time, day, existing: dose })}>{text}</button></td>;
            })}
          </tr>;
        })}</tbody></table></div> : <p className="empty-state">No medications are recorded for this client. Add them on the Medications tab.</p>}
      <div className="med-legend"><span><i className="med-cell given">AB</i>Given (staff initials)</span><span><i className="med-cell refused">R</i>Refused</span><span><i className="med-cell held">H</i>Held</span><span><i className="med-cell notgiven">N</i>Not given</span><span><i className="med-cell historical">◆</i>Historical paper MAR, electronically verified later</span>{me.canRecord ? <span className="med-noprint">Authorized staff may record today or a reasoned late entry from the prior seven days. Existing entries require a signed correction.</span> : null}</div>

      <h4 style={{ margin: "6px 0 0" }}>Weekly sign-off</h4>
      <div className="med-weeks">{data.weeks.map(week => <WeekBox key={week.weekStart} week={week} data={data} busy={busy} onSign={() => act({ action: "SIGN_WEEK", weekStart: week.weekStart })} />)}</div>

      <h4 style={{ margin: "6px 0 0" }}>Staff key</h4>
      {data.staff.length ? <div className="med-staff">{data.staff.map(s => <div key={s.userId}><b>{s.initials}</b>{s.typedName} · <span className="med-sig">{s.typedName}</span></div>)}</div> : <p className="med-note">No staff have set up a signature yet.</p>}

      {admin ? <details className="med-admin med-noprint"><summary>Administrator only · counts and entry history (not shown on the MAR or its print-out)</summary>
        <div className="med-admin-counts"><span><b>{admin.summary.given}</b> given</span><span><b>{admin.summary.refused}</b> refused</span><span><b>{admin.summary.held}</b> held</span><span><b>{admin.summary.notGiven}</b> not given</span><span><b>{admin.summary.notDocumented}</b> not documented</span><span className="med-note">for {monthLabel(month)}, through today</span></div>
        {admin.history.length ? <table className="med-history"><thead><tr><th>Changed</th><th>Record</th><th>What</th><th>By</th></tr></thead><tbody>{admin.history.map(h => <tr key={h.id}><td>{new Date(h.changedAt).toLocaleString()}</td><td>{h.label}</td><td>{h.entityType === "DOSE" ? "Dose" : h.entityType === "WEEK_SIGNOFF" ? "Weekly sign-off" : "Medication"} · {h.action.toLowerCase()}</td><td>{h.changedBy}</td></tr>)}</tbody></table> : <p className="med-note">No changes recorded yet.</p>}
      </details> : null}
    </>}

    {target ? <DosePanel target={target} data={data} busy={busy} onClose={() => setTarget(null)} onSave={async body => { if (await act({ action: "SAVE_DOSE", medicationId: target.medication.id, doseDate: target.day, scheduledTime: target.time, ...body })) setTarget(null); }} /> : null}
  </section>;
}

function SignatureSetup({ consent, busy, onSave }: { consent: string; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(""), [agree, setAgree] = useState(false);
  return <div className="med-setup med-noprint"><strong>Set up your signature (one time)</strong><p className="med-note" style={{ margin: 0 }}>Your typed name is stored and applied each time you sign a dose or a week.</p>
    <label>Type your full legal name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
    {name.trim() ? <div className="med-sig" aria-label="Signature preview">{name}</div> : null}
    <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{consent}</span></label>
    <div><button type="button" disabled={busy || name.trim().length < 2 || !agree} onClick={() => onSave(name.trim())}>Adopt signature</button></div></div>;
}

function WeekBox({ week, data, busy, onSign }: { week: Week; data: MarData; busy: boolean; onSign: () => void }) {
  return <div className={week.signoff ? "signed" : ""}>
    <b>{shortDay(week.firstDay)} – {shortDay(week.lastDay)}</b>
    {week.signoff ? <><span className="med-sig">{week.signoff.signerName}</span><small>Reviewed</small></> : <small>Not signed off</small>}
    {data.me.canSignWeek && !week.signoff ? <div className="med-noprint" style={{ display: "grid", gap: 4 }}>
      <button type="button" disabled={busy || !data.me.hasSignature} onClick={onSign}>Sign off week</button>
    </div> : null}
  </div>;
}

function DosePanel({ target, data, busy, onClose, onSave }: { target: Target; data: MarData; busy: boolean; onClose: () => void; onSave: (body: { [key: string]: unknown }) => void }) {
  const { existing } = target, [status, setStatus] = useState<DoseStatus>(existing?.status ?? "GIVEN"), [timeGiven, setTimeGiven] = useState(existing?.timeGiven ?? (target.time === UNSCHEDULED_TIME ? "" : target.time)), [note, setNote] = useState(existing?.note ?? "");
  const [lateEntryReason, setLateEntryReason] = useState(""), [correctionReason, setCorrectionReason] = useState("");
  const signerName = data.staff.find(s => s.userId === data.me.userId)?.typedName ?? "";
  return <div className="med-dialog" role="dialog" aria-modal="true" aria-label="MarData dose" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="med-panel">
      <h4>{target.medication.medication}{target.medication.dose ? ` ${target.medication.dose}` : ""} · {timeLabel(target.time)}</h4>
      <div className="row"><b>Dose date</b><span>{longDay(target.day)}{target.day < data.today ? " (past date)" : ""}</span></div>
      <label className="row"><b>Status</b><select value={status} onChange={e => setStatus(e.target.value as DoseStatus)}>{(Object.keys(CELL) as DoseStatus[]).map(key => <option key={key} value={key}>{CELL[key].name}</option>)}</select></label>
      {status === "GIVEN" ? <label className="row"><b>Time given</b><input type="time" value={timeGiven} onChange={e => setTimeGiven(e.target.value)} /></label> : null}
      <div className="row"><b>Recorded by</b><span>{signerName || "Set up your signature first"}</span></div>
      <label className="row"><b>Note</b><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      {target.day < data.today && !existing ? <label className="row"><b>Late-entry reason</b><textarea required minLength={10} rows={2} value={lateEntryReason} onChange={e => setLateEntryReason(e.target.value)} /></label> : null}
      {existing ? <label className="row"><b>Correction reason</b><textarea required minLength={10} rows={2} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} /></label> : null}
      <div className="row"><b>Signature</b><span><span className="med-sig">{signerName || "—"}</span> <small className="med-note">stored signature</small></span></div>
      <div className="actions">
        <button type="button" disabled={busy || !signerName || (status === "GIVEN" && !timeGiven) || (status !== "GIVEN" && !note.trim()) || (target.day < data.today && !existing && lateEntryReason.trim().length < 10) || Boolean(existing && correctionReason.trim().length < 10)} onClick={() => onSave({ status, timeGiven: status === "GIVEN" ? timeGiven || null : null, note: note.trim() || null, lateEntryReason: lateEntryReason.trim() || null, correctionReason: correctionReason.trim() || null, expectedUpdatedAt: existing?.updatedAt })}>{existing ? "Sign correction" : "Sign & save"}</button>
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      </div>
      <p className="med-note" style={{ margin: 0 }}>The entry is dated {longDay(target.day)} on the MAR no matter when it is entered or signed.</p>
    </div></div>;
}

type HistoricalAction = (body: { [key: string]: unknown }) => Promise<Record<string, unknown> | null>;
type PavilioInspection = { workbookHash: string; totalRows: number; usableRows: number; errorCounts: Record<string, number>; dateCoverage: { start: string; end: string } | null; sourceEmployees: { sourceEmployeeId: string; sourceEmployeeName: string; usableRowCount: number; suggestedEmployeeId: string | null }[]; employees: { id: string; employeeNumber: string | null; name: string; employmentStatus: string }[] };
type PavilioPreview = { fingerprint: string; total: number; readyForCaregiverReview: number; blocked: number; counts: Record<string, number>; workbook: { reconciliationCounts: Record<string, number> } };
function HistoricalMarPanel({ data, busy, act, clientId }: { data: MarData; busy: boolean; act: HistoricalAction; clientId: string }) {
  const today = data.today, monthAgo = new Date(`${today}T12:00:00Z`); monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
  const [rangeStart, setRangeStart] = useState(monthAgo.toISOString().slice(0, 10)), [rangeEnd, setRangeEnd] = useState(today);
  const [preview, setPreview] = useState<{ fingerprint: string; total: number; readyForCaregiverReview: number; blocked: number; counts: Record<string, number> } | null>(null);
  const [pavilioFile, setPavilioFile] = useState<{ fileName: string; workbookBase64: string } | null>(null), [clientConfirmed, setClientConfirmed] = useState(false);
  const [pavilioInspection, setPavilioInspection] = useState<PavilioInspection | null>(null), [pavilioMappings, setPavilioMappings] = useState<Record<string, string>>({}), [pavilioPreview, setPavilioPreview] = useState<PavilioPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewStart, setReviewStart] = useState(""), [reviewEnd, setReviewEnd] = useState(""), [medicationFilter, setMedicationFilter] = useState(""), [batchFilter, setBatchFilter] = useState("");
  const ready = data.historical.entries.filter(entry => entry.reviewState === "SOURCE_VERIFIED" && data.historical.canAttest);
  const batches = [...new Set(ready.map(entry => entry.batchId))];
  const medicationOptions = [...new Set(data.historical.entries.map(entry => entry.medication.medication))].sort();
  const filteredEntries = data.historical.entries.filter(entry => (!reviewStart || entry.doseDate >= reviewStart) && (!reviewEnd || entry.doseDate <= reviewEnd) && (!medicationFilter || entry.medication.medication === medicationFilter) && (!batchFilter || entry.batchId === batchFilter));
  async function previewImport() {
    const result = await act({ action: "PREVIEW_HISTORICAL_MAR", rangeStart, rangeEnd });
    if (result) setPreview(result as unknown as typeof preview);
  }
  async function stageImport() {
    if (!preview) return;
    if (await act({ action: "STAGE_HISTORICAL_MAR", rangeStart, rangeEnd, expectedFingerprint: preview.fingerprint })) setPreview(null);
  }
  async function attest(batchId: string) {
    const ids = [...selected].filter(id => ready.some(entry => entry.id === id && entry.batchId === batchId));
    if (!ids.length) return;
    const batch = data.historical.batches.find(item => item.id === batchId);
    if (await act({ action: "ATTEST_HISTORICAL_MAR_ENTRIES", batchId, entryIds: ids, rangeStart: batch?.rangeStart, rangeEnd: batch?.rangeEnd, consent: true })) setSelected(new Set());
  }
  async function choosePavilio(file: File | undefined) {
    setPavilioInspection(null); setPavilioPreview(null); setPavilioMappings({});
    if (!file) { setPavilioFile(null); return; }
    const workbookBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read workbook")); reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? ""); reader.readAsDataURL(file); });
    setPavilioFile({ fileName: file.name, workbookBase64 });
  }
  const pavilioPayload = () => pavilioFile ? { ...pavilioFile, confirmedClientId: clientId, confirmClient: true, employeeMappings: Object.entries(pavilioMappings).map(([sourceEmployeeId, employeeId]) => ({ sourceEmployeeId, employeeId: employeeId === "__UNRESOLVED__" ? null : employeeId })) } : null;
  async function inspectPavilio() {
    if (!pavilioFile || !clientConfirmed) return;
    const result = await act({ action: "INSPECT_PAVILIO_ATTENDANCE", ...pavilioFile, confirmedClientId: clientId, confirmClient: true });
    if (!result) return;
    const value = result as unknown as PavilioInspection; setPavilioInspection(value); setPavilioMappings(Object.fromEntries(value.sourceEmployees.map(employee => [employee.sourceEmployeeId, employee.suggestedEmployeeId ?? ""]))); setPavilioPreview(null);
  }
  async function previewPavilio() {
    const payload = pavilioPayload(); if (!payload) return;
    const result = await act({ action: "PREVIEW_PAVILIO_HISTORICAL_MAR", ...payload }); if (result) setPavilioPreview(result as unknown as PavilioPreview);
  }
  async function stagePavilio() {
    const payload = pavilioPayload(); if (!payload || !pavilioPreview) return;
    if (await act({ action: "STAGE_PAVILIO_HISTORICAL_MAR", ...payload, expectedFingerprint: pavilioPreview.fingerprint })) { setPavilioPreview(null); setPavilioInspection(null); setPavilioFile(null); setPavilioMappings({}); setClientConfirmed(false); }
  }
  return <div className="med-historical">
    <div className="med-callout"><strong>Historical MAR reconstruction and source verification</strong><p>Scheduled records and attendance evidence never prove administration. An authorized current reviewer must personally compare each selected outcome with the identified paper MAR or other authoritative record, then sign the exact verified set.</p></div>
    {data.historical.completeness?.map(item => <section className="med-preview" key={`complete-${item.batchId}`} aria-label={`Historical MAR completeness ${item.rangeStart} through ${item.rangeEnd}`}><strong>{item.rangeStart}–{item.rangeEnd} · {item.complete ? "verified complete" : "reconstruction incomplete"}</strong><div className="med-preview-counts"><span>expected {item.expectedScheduledOccurrences}</span><span>scheduled drafts {item.draftOccurrences}</span><span>awaiting source review {item.awaitingSourceReview}</span><span>source verified {item.verifiedEntries}</span><span>attested {item.attestedEntries}</span><span>missing attendance {item.missingAttendance}</span><span>unresolved caregivers {item.unresolvedCaregiverIdentities}</span><span>attendance conflicts {item.conflictingAttendance}</span><span>missing medication authorization {item.missingMedicationAuthorization}</span><span>unresolved outcomes {item.unresolvedAdministrationOutcomes}</span></div></section>)}
    {data.historical.canImport ? <section className="med-import med-noprint" aria-label="Historical MAR import">
      <h4>Generate historical reconstruction</h4>
      <div className="med-import-range"><label>From<input type="date" value={rangeStart} max={rangeEnd} onChange={event => { setRangeStart(event.target.value); setPreview(null); }} /></label><label>Through<input type="date" value={rangeEnd} min={rangeStart} max={today} onChange={event => { setRangeEnd(event.target.value); setPreview(null); }} /></label><button type="button" className="secondary" disabled={busy} onClick={() => void previewImport()}>Preview</button></div>
      {preview ? <div className="med-preview" role="status"><b>{preview.total}</b> scheduled occurrences · <b>{preview.readyForCaregiverReview}</b> eligible for source review · <b>{preview.blocked}</b> unresolved<div className="med-preview-counts">{Object.entries(preview.counts).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ").toLowerCase()}: {value}</span>)}</div><button type="button" disabled={busy} onClick={() => void stageImport()}>Confirm and stage reconstruction</button></div> : null}
      {data.historical.batches.length ? <div className="med-batches">{data.historical.batches.map(batch => <span key={batch.id}>{batch.rangeStart}–{batch.rangeEnd} · {batch.status.replaceAll("_", " ").toLowerCase()}</span>)}</div> : null}
    </section> : null}
    {data.historical.canImport ? <section className="med-import med-noprint" aria-label="Verified Pavilio attendance import">
      <h4>Supplement incomplete AxisCare attendance</h4><p className="med-note">Upload the verified Pavilio shift workbook for this client. AxisCare remains primary; duplicates and conflicting overlaps are not used as supplemental coverage.</p>
      <label>Pavilio XLSX workbook<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void choosePavilio(event.target.files?.[0])} /></label>
      <label className="check"><input type="checkbox" checked={clientConfirmed} onChange={event => { setClientConfirmed(event.target.checked); setPavilioInspection(null); setPavilioPreview(null); }} /><span>I confirm this workbook belongs to the client whose MAR is open.</span></label>
      <button type="button" className="secondary" disabled={busy || !pavilioFile || !clientConfirmed} onClick={() => void inspectPavilio()}>Inspect workbook (no changes)</button>
      {pavilioInspection ? <div className="med-preview"><b>{pavilioInspection.usableRows}</b> usable of {pavilioInspection.totalRows} attendance rows{pavilioInspection.dateCoverage ? ` · ${pavilioInspection.dateCoverage.start}–${pavilioInspection.dateCoverage.end}` : ""}<div className="med-preview-counts">{Object.entries(pavilioInspection.errorCounts).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ").toLowerCase()}: {value}</span>)}</div><h5>Confirm historical caregiver mappings</h5>{pavilioInspection.sourceEmployees.map(source => <label key={source.sourceEmployeeId}>{source.sourceEmployeeName} · source ID {source.sourceEmployeeId} · {source.usableRowCount} rows<select value={pavilioMappings[source.sourceEmployeeId] ?? ""} onChange={event => { setPavilioMappings(current => ({ ...current, [source.sourceEmployeeId]: event.target.value })); setPavilioPreview(null); }}><option value="">Choose a stable mapping</option><option value="__UNRESOLVED__">Keep source identity unresolved</option>{pavilioInspection.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber ?? "no employee number"} · {employee.employmentStatus.toLowerCase()}</option>)}</select></label>)}<button type="button" disabled={busy || pavilioInspection.sourceEmployees.some(source => !pavilioMappings[source.sourceEmployeeId])} onClick={() => void previewPavilio()}>Preview reconciled MAR staging</button></div> : null}
      {pavilioPreview ? <div className="med-preview" role="status"><b>{pavilioPreview.total}</b> scheduled occurrences · <b>{pavilioPreview.readyForCaregiverReview}</b> ready · <b>{pavilioPreview.blocked}</b> blocked<div className="med-preview-counts">{Object.entries(pavilioPreview.counts).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ").toLowerCase()}: {value}</span>)}{Object.entries(pavilioPreview.workbook.reconciliationCounts).map(([key, value]) => <span key={`reconcile-${key}`}>attendance {key.replaceAll("_", " ").toLowerCase()}: {value}</span>)}</div><button type="button" disabled={busy} onClick={() => void stagePavilio()}>Confirm and stage reviewed preview</button></div> : null}
    </section> : null}
    {data.historical.entries.length ? <><div className="med-history-filters med-noprint" aria-label="Historical MAR review filters"><label>From<input type="date" value={reviewStart} max={reviewEnd || undefined} onChange={event => setReviewStart(event.target.value)} /></label><label>Through<input type="date" value={reviewEnd} min={reviewStart || undefined} onChange={event => setReviewEnd(event.target.value)} /></label><label>Medication<select value={medicationFilter} onChange={event => setMedicationFilter(event.target.value)}><option value="">All medications</option>{medicationOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Import batch<select value={batchFilter} onChange={event => setBatchFilter(event.target.value)}><option value="">All batches</option>{data.historical.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.rangeStart}–{batch.rangeEnd}</option>)}</select></label><button type="button" className="secondary" onClick={() => { setReviewStart(""); setReviewEnd(""); setMedicationFilter(""); setBatchFilter(""); }}>Clear filters</button></div>{filteredEntries.length ? <div className="med-history-list">{filteredEntries.map(entry => <HistoricalEntryCard key={entry.id} entry={entry} busy={busy} act={act} canReview={Boolean(data.historical.canReview)} canAttest={Boolean(data.historical.canAttest)} selected={selected.has(entry.id)} onSelect={checked => setSelected(current => { const next = new Set(current); if (checked) next.add(entry.id); else next.delete(entry.id); return next; })} />)}</div> : <p className="empty-state">No staged entries match these filters.</p>}</> : <p className="empty-state">No historical MAR entries are staged for this client.</p>}
    {batches.map(batchId => {
      const count = ready.filter(entry => entry.batchId === batchId && selected.has(entry.id)).length;
      return <div className="med-attest med-noprint" key={batchId}><p>{data.historical.statement}</p><button type="button" disabled={busy || !data.me.hasSignature || !count} onClick={() => void attest(batchId)}>Sign {count || "selected"} reviewed {count === 1 ? "entry" : "entries"}</button>{!data.me.hasSignature ? <small>Set up your medication signature above before attesting.</small> : null}</div>;
    })}
  </div>;
}

function HistoricalEntryCard({ entry, busy, act, canReview: mayReview, canAttest, selected, onSelect }: { entry: HistoricalEntry; busy: boolean; act: HistoricalAction; canReview: boolean; canAttest: boolean; selected: boolean; onSelect: (checked: boolean) => void }) {
  const [status, setStatus] = useState<DoseStatus>(entry.paperStatus ?? "GIVEN"), [timeGiven, setTimeGiven] = useState(entry.paperTimeGiven ?? entry.scheduledTime), [note, setNote] = useState(entry.paperNote ?? "");
  const [sourceReference, setSourceReference] = useState(entry.sourceReference ?? ""), [sourceDescription, setSourceDescription] = useState(entry.sourceDescription ?? ""), [sourceCaregiverSigned, setSourceCaregiverSigned] = useState(entry.sourceCaregiverSigned ?? false);
  const [discrepancy, setDiscrepancy] = useState(entry.discrepancyNote ?? ""), [correctionReason, setCorrectionReason] = useState("");
  const canReview = mayReview && entry.medicationAuthorizationState === "APPROVED" && !["EXISTING_MAR_ENTRY", "MEDICATION_HISTORY_GAP"].includes(entry.matchState);
  async function save() { await act({ action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId: entry.id, expectedVersion: entry.version, personallyCompared: true, paperStatus: status, paperTimeGiven: status === "GIVEN" ? timeGiven : null, paperNote: note || null, sourceReference: sourceReference || null, sourceDescription: sourceDescription || null, sourceCaregiverSigned, discrepancyCode: discrepancy ? "PAPER_MAR_DISCREPANCY" : null, discrepancyNote: discrepancy || null, correctionReason: entry.reviewState === "ATTESTED" ? correctionReason : null }); }
  async function flag() { await act({ action: "FLAG_HISTORICAL_MAR_ENTRY", entryId: entry.id, expectedVersion: entry.version, discrepancyCode: "SOURCE_REVIEW_UNRESOLVED", discrepancyNote: discrepancy || "The source review could not resolve this historical entry.", sourceReference: sourceReference || null }); }
  return <article className={`med-history-card ${entry.reviewState.toLowerCase()}`}>
    <header><div><strong>{entry.medication.medication}{entry.medication.dose ? ` ${entry.medication.dose}` : ""}</strong><span>{longDay(entry.doseDate)} · {timeLabel(entry.scheduledTime)} · {entry.employee ? `${entry.employee.name} (${entry.employee.employmentStatus.toLowerCase()})` : "Unresolved historical caregiver"}</span></div><b className="med-state">{entry.reviewState.replaceAll("_", " ").toLowerCase()}</b></header>
    <div className="med-evidence"><span>Reconstruction: {entry.reconstructionState.toLowerCase()}</span><span>Medication authorization: {entry.medicationAuthorizationState.replaceAll("_", " ").toLowerCase()}</span><span>Attendance: {entry.attendanceSource.toLowerCase()} · {entry.matchState.replaceAll("_", " ").toLowerCase()}</span><span>{entry.confidence.replaceAll("_", " ").toLowerCase()}</span>{entry.visit?.clockInAt && entry.visit.clockOutAt ? <span>Actual visit {new Date(entry.visit.clockInAt).toLocaleString()}–{new Date(entry.visit.clockOutAt).toLocaleTimeString()}</span> : null}</div>
    {canReview ? <div className="med-review-grid med-noprint"><label>Authoritative source reference<input value={sourceReference} onChange={event => setSourceReference(event.target.value)} placeholder="Paper MAR location or controlled evidence reference" /></label><label>Controlled source description<textarea rows={2} value={sourceDescription} onChange={event => setSourceDescription(event.target.value)} placeholder="Describe the record reviewed without uploading it" /></label><label className="check"><input type="checkbox" checked={sourceCaregiverSigned} onChange={event => setSourceCaregiverSigned(event.target.checked)} /><span>The original source visibly contains the historical caregiver&apos;s signature</span></label><label>Source-record outcome<select value={status} onChange={event => setStatus(event.target.value as DoseStatus)}>{(Object.keys(CELL) as DoseStatus[]).map(value => <option key={value} value={value}>{CELL[value].name}</option>)}</select></label>{status === "GIVEN" ? <label>Source-record time given<input type="time" value={timeGiven} onChange={event => setTimeGiven(event.target.value)} /></label> : null}<label>Transcription note<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} /></label><label>Unresolved discrepancy<textarea rows={2} value={discrepancy} onChange={event => setDiscrepancy(event.target.value)} placeholder="Describe anything that remains unresolved" /></label>{entry.reviewState === "ATTESTED" ? <label>Correction reason<textarea required minLength={10} rows={2} value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} /></label> : null}<div><button type="button" disabled={busy || (!sourceReference.trim() && !sourceDescription.trim()) || (status === "GIVEN" && !timeGiven) || (status !== "GIVEN" && !note.trim()) || Boolean(discrepancy.trim()) || (entry.reviewState === "ATTESTED" && correctionReason.trim().length < 10)} onClick={() => void save()}>{entry.reviewState === "ATTESTED" ? "Source-verify correction" : "Mark source-verified"}</button><button type="button" className="secondary" disabled={busy || discrepancy.trim().length < 10} onClick={() => void flag()}>Leave unresolved</button></div></div> : <p className="med-note">This scheduled draft cannot be source-verified until its medication authorization or schedule conflict is resolved.</p>}
    {canAttest && entry.reviewState === "SOURCE_VERIFIED" ? <label className="check med-noprint"><input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} /><span>Include this source-verified entry in the exact monthly signature set</span></label> : null}
    {entry.attestation ? <small>Electronically verified later on {new Date(entry.attestation.signedAt).toLocaleString()} · signature snapshot {entry.attestation.snapshotHash.slice(0, 12)}…</small> : null}
  </article>;
}

type MedForm = { id?: string; medication: string; dose: string; route: string; times: string; reason: string; prescriber: string; startDate: string; stopDate: string };
function MedicationList({ data, editing, setEditing, busy, onSave, onApprove, onHistoricalApprove }: { data: MarData; editing: Medication | "new" | null; setEditing: (value: Medication | "new" | null) => void; busy: boolean; onSave: (value: { [key: string]: unknown }) => void; onApprove: (id: string) => void; onHistoricalApprove: (value: { id: string; effectiveFrom: string; effectiveThrough: string; sourceReference: string }) => void }) {
  const initial = (m: Medication | "new" | null): MedForm => (m && m !== "new" ? { id: m.id, medication: m.medication, dose: m.dose ?? "", route: m.route ?? "", times: m.times ?? "", reason: m.reason ?? "", prescriber: m.prescriber ?? "", startDate: m.startDate ?? "", stopDate: m.stopDate ?? "" } : { medication: "", dose: "", route: "", times: "", reason: "", prescriber: "", startDate: "", stopDate: "" });
  const [form, setForm] = useState<MedForm>(initial(editing));
  const [historicalApproval, setHistoricalApproval] = useState<{ id: string; effectiveFrom: string; effectiveThrough: string; sourceReference: string } | null>(null);
  useEffect(() => setForm(initial(editing)), [editing]);
  const set = (key: keyof MedForm) => (e: { target: { value: string } }) => setForm(prev => ({ ...prev, [key]: e.target.value }));
  return <div style={{ display: "grid", gap: 12 }}>
    {data.me.canProposeMedications ? <div className="med-noprint"><button type="button" onClick={() => setEditing("new")}>+ Add medication</button></div> : <p className="med-note med-noprint">Medications can be added by an organization manager or a clinical reviewer.</p>}
    {data.me.canProposeMedications ? <p className="med-note med-noprint">New medications stay <b>pending approval</b> and cannot be used on the MAR until a clinical reviewer (a verified, current RN, CNS, CNP, PA or physician) explicitly approves them. Changing an approved medication sends it back for approval.</p> : null}
    {editing ? <form className="med-form med-noprint" onSubmit={e => { e.preventDefault(); onSave({ id: form.id, medication: form.medication, dose: form.dose || null, route: form.route || null, times: form.times || null, reason: form.reason || null, prescriber: form.prescriber || null, startDate: form.startDate || null, stopDate: form.stopDate || null }); }}>
      <label>Medication<input required value={form.medication} onChange={set("medication")} /></label>
      <label>Dose<input value={form.dose} onChange={set("dose")} placeholder="100 mg" /></label>
      <label>Route<input value={form.route} onChange={set("route")} placeholder="by mouth" /></label>
      <label>Times<input value={form.times} onChange={set("times")} placeholder="8 AM, 8 PM" /></label>
      <label>Reason<input value={form.reason} onChange={set("reason")} /></label>
      <label>Prescriber<input value={form.prescriber} onChange={set("prescriber")} /></label>
      <label>Start date<input type="date" value={form.startDate} onChange={set("startDate")} /></label>
      <label>Stop date<input type="date" value={form.stopDate} onChange={set("stopDate")} /></label>
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}><button disabled={busy}>Save medication</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button></div>
    </form> : null}
    {data.medications.length ? <table className="med-list"><thead><tr><th>Medication</th><th>Dose · route</th><th>Times</th><th>Reason</th><th>Prescriber</th><th>Ordered</th><th>MAR status</th><th /></tr></thead><tbody>{data.medications.map(m => <tr key={m.id}><td><strong>{m.medication}</strong></td><td>{[m.dose, m.route].filter(Boolean).join(" · ") || "—"}</td><td>{m.times ?? "—"}</td><td>{m.reason ?? "—"}</td><td>{m.prescriber ?? "—"}</td><td>{m.startDate ? shortDay(m.startDate) : "—"}{m.stopDate ? ` → ${shortDay(m.stopDate)}` : ""}</td><td>{m.marApproved ? <>{m.historicalApprovedFrom ? `Retrospectively authorized ${shortDay(m.historicalApprovedFrom)}–${shortDay(m.historicalApprovedThrough!)}` : "Approved"}</> : <span className="med-pending">Pending clinical approval</span>}</td><td className="med-noprint" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{data.me.canProposeMedications ? <button type="button" className="secondary" onClick={() => setEditing(m)}>Edit</button> : null}{data.me.canEditMedications && !m.marApproved && (!m.stopDate || m.stopDate >= data.today) ? <button type="button" disabled={busy} onClick={() => onApprove(m.id)}>Approve for MAR</button> : null}{data.me.canEditMedications && m.startDate && m.stopDate && m.stopDate < data.today ? <button type="button" className="secondary" disabled={busy} onClick={() => setHistoricalApproval({ id: m.id, effectiveFrom: m.startDate!, effectiveThrough: m.stopDate!, sourceReference: "" })}>Authorize historical schedule</button> : null}</td></tr>)}</tbody></table> : <p className="empty-state">No medications recorded.</p>}
    {historicalApproval ? <form className="med-form med-noprint" onSubmit={event => { event.preventDefault(); onHistoricalApprove(historicalApproval); setHistoricalApproval(null); }}><h4>Retrospective clinical authorization</h4><p className="med-note">This records the actual authorization time now. It does not backdate approval or assert that any dose was given.</p><label>Effective from<input type="date" required value={historicalApproval.effectiveFrom} onChange={event => setHistoricalApproval(current => current && ({ ...current, effectiveFrom: event.target.value }))} /></label><label>Effective through<input type="date" required max={data.today} value={historicalApproval.effectiveThrough} onChange={event => setHistoricalApproval(current => current && ({ ...current, effectiveThrough: event.target.value }))} /></label><label>Clinical source reference<input required minLength={3} maxLength={300} value={historicalApproval.sourceReference} onChange={event => setHistoricalApproval(current => current && ({ ...current, sourceReference: event.target.value }))} placeholder="Controlled paper order or other authoritative reference" /></label><div><button disabled={busy || historicalApproval.sourceReference.trim().length < 3}>Record authorization now</button><button type="button" className="secondary" onClick={() => setHistoricalApproval(null)}>Cancel</button></div></form> : null}
    <p className="med-note">Set a start date for each medication so the MAR knows which days it applies to. Times such as &ldquo;8 AM, 8 PM&rdquo; become the rows of the MAR.</p>
  </div>;
}
