"use client";
import { FormEvent, useEffect, useState } from "react";
type Summary = {
  employeesRequiringAttention: number;
  openActions: number;
  openComplianceIssues: number;
  overdue: number;
  dueSoon: number;
  clientDocumentRenewals: number;
  clientDocumentRequests: number;
  trainingActions: number;
  policyActions: number;
  competencyActions: number;
  evidenceAwaitingReview: number;
  medicationClinicalActions: number;
  serviceAssignmentBlockers: number;
  remediationInProgress: number;
};
type Action = {
  id: string;
  sourceType: string;
  sourceId: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string | null;
  };
  category: string;
  actionType: string;
  status: string;
  deadlineState: string;
  dueAt: string | null;
  priority: string | null;
  reason: string;
  remediationState: string;
  nextAction: string;
  clinicallyPrivileged: boolean;
  employeeHref: string;
};
type Evidence = {
  id: string;
  employee: { firstName: string; lastName: string };
  evidenceType: string;
  source: string;
  title: string;
  submittedAt: string;
  reviewState: string;
  requirementContext: string | null;
  reviewerActionAvailable: boolean;
};
type Activity = {
  id: string;
  eventType: string;
  entityType: string;
  actor: string;
  occurredAt: string;
};
type ClientRequest = {
  id: string;
  requestId: string;
  client: { id: string; legalFirstName: string; legalLastName: string };
  documentName: string;
  documentType: string;
  recipientName: string;
  status: string;
  requestedAt: string;
  dueAt: string | null;
  deadlineState: string;
  latestFollowUpAt: string | null;
  followUpCount: number;
  actionHref: string;
};
type ClientRenewal = {
  id: string;
  client: { id: string; legalFirstName: string; legalLastName: string };
  documentId: string;
  templateName: string;
  documentType: string;
  status: string;
  dueDate: string;
  daysUntilDue: number;
  workflow: { status: string; envelopeStatus: string | null } | null;
  requests: ClientRequest[];
  actionHref: string;
};
type Result = {
  summary: Summary;
  actions: Action[];
  clientDocumentRenewals: ClientRenewal[];
  clientDocumentRequests: ClientRequest[];
  evidenceReview: Evidence[];
  recentActivity: Activity[];
  emptyState: string | null;
  filters: { page: number; pages: number; total: number; pageSize: number };
  dueSoonDays: number;
};
const pretty = (v: string) => v.toLowerCase().replaceAll("_", " ");
const when = (v: string | null) => (v ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(v)) : "No determinable deadline");
export default function ActionCenter({initialOrganizationId="",productionIdentity=false}:{initialOrganizationId?:string;productionIdentity?:boolean}) {
  const [userId, setUserId] = useState(""),
    [organizationId, setOrganizationId] = useState(initialOrganizationId),
    [result, setResult] = useState<Result | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [deadline, setDeadline] = useState(""),
    [page, setPage] = useState(1);
  const headers:Record<string,string> = productionIdentity?{"content-type":"application/json"}:{"content-type": "application/json","x-dev-user-id": userId};
  async function load(nextPage = 1) {
    setBusy(true);
    setMessage("");
    try {
      const q = new URLSearchParams({
          search,
          category,
          deadlineState: deadline,
          page: String(nextPage),
          pageSize: "25",
        }),
        r = await fetch(`/api/organizations/${organizationId}/action-center?${q}`, { headers }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Unable to load Action Center");
      setResult(b);
      setPage(nextPage);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to load Action Center");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch(`/api/organizations/${organizationId}/action-center/refresh`, { method: "POST", headers, body: "{}" }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Refresh failed");
      setResult(b.actionCenter);
      setPage(1);
      setMessage("Authoritative reconciliation completed; no issue was manually resolved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }
  async function remediate(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/organizations/${organizationId}/compliance/issues/${id}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "START_REMEDIATION" }),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Remediation failed");
      setMessage("Remediation started. Compliance status remains evidence-driven.");
      await load(page);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Remediation failed");
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void load(1);
  }
  // The authenticated landing route fixes the organization for the mounted production view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(productionIdentity&&organizationId)void load(1)},[productionIdentity,organizationId]);
  return (
    <main className="admin-shell">
      <header>
        <p className="eyebrow">Phase 17 · Employer operations</p>
        <h1>Compliance Action Center</h1>
        <p className="lede">Prioritized operational actions derived from recorded compliance, evidence, clinical, assignment, client-document renewal, and audit state. This view is not a legal certification.</p>
      </header>
      {!productionIdentity?<section className="portal-signin">
        <h2>Organization access</h2>
        <form className="auth" onSubmit={submit}>
          <label>
            <span>Authenticated administrator ID</span>
            <input required value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>Organization ID</span>
            <input required value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
          </label>
          <button disabled={busy}>{busy ? "Loading…" : "Open Action Center"}</button>
        </form>
      </section>:null}
      <p className="portal-message" role="status" aria-live="polite">
        {message}
      </p>
      {result ? (
        <>
          <section>
            <div className="section-heading">
              <div>
                <h2>Ongoing compliance operations</h2>
                <p>Due soon uses each authoritative source&apos;s configured warning window and does not alter its deadline.</p>
              </div>
              <button disabled={busy} onClick={refresh}>
                Refresh compliance
              </button>
            </div>
            <div className="metric-grid">
              <Metric n={result.summary.employeesRequiringAttention} l="employees requiring attention" />
              <Metric n={result.summary.openComplianceIssues} l="open compliance issues" />
              <Metric n={result.summary.overdue} l="overdue actions" />
              <Metric n={result.summary.dueSoon} l="due soon" />
              <Metric n={result.summary.clientDocumentRenewals} l="client document renewals" />
              <Metric n={result.summary.clientDocumentRequests} l="client document requests" />
              <Metric n={result.summary.evidenceAwaitingReview} l="evidence reviews" />
              <Metric n={result.summary.medicationClinicalActions} l="clinical actions" />
              <Metric n={result.summary.serviceAssignmentBlockers} l="assignment blockers" />
              <Metric n={result.summary.remediationInProgress} l="remediations in progress" />
            </div>
          </section>
          <section>
            <h2>Action Center</h2>
            <form className="filters" onSubmit={submit}>
              <label>
                Search employee or action
                <input value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {["TRAINING", "POLICY", "COMPETENCY", "EVIDENCE", "CREDENTIAL", "MEDICATION_CLINICAL", "SERVICE_ASSIGNMENT", "GENERAL_COMPLIANCE"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Deadline state
                <select value={deadline} onChange={(e) => setDeadline(e.target.value)}>
                  <option value="">All deadline states</option>
                  {["OVERDUE", "DUE_SOON", "FUTURE", "NO_DEADLINE", "REQUIRES_REVIEW"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Apply filters</button>
            </form>
            {result.actions.length ? (
              result.actions.map((a) => (
                <article key={a.id}>
                  <p className="eyebrow">
                    {pretty(a.category)} · {pretty(a.deadlineState)}
                    {a.priority ? ` · ${pretty(a.priority)}` : ""}
                  </p>
                  <h3>
                    {a.employee.firstName} {a.employee.lastName}: {pretty(a.actionType)}
                  </h3>
                  <p>{a.reason}</p>
                  <p>
                    <strong>{when(a.dueAt)}</strong> · {pretty(a.status)} · remediation {pretty(a.remediationState)}
                  </p>
                  {a.clinicallyPrivileged ? <p role="note">Clinical authorization is required. Administrative visibility does not grant clinical authority.</p> : null}
                  <p>{a.nextAction}</p>
                  <a href={a.employeeHref}>Open employee compliance context</a>
                  {a.sourceType === "ComplianceIssue" && a.status === "OPEN" ? (
                    <button disabled={busy} onClick={() => remediate(a.sourceId)}>
                      Start remediation
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-state">{result.emptyState ?? "No employee actions match these filters."}</div>
            )}
            <nav aria-label="Action Center pages">
              <button disabled={page <= 1 || busy} onClick={() => load(page - 1)}>
                Previous
              </button>
              <span>
                {" "}
                Page {page} of {result.filters.pages} · {result.filters.total} actions{" "}
              </span>
              <button disabled={page >= result.filters.pages || busy} onClick={() => load(page + 1)}>
                Next
              </button>
            </nav>
          </section>
          <section>
            <h2>Client document renewals</h2>
            {result.clientDocumentRenewals.length ? (
              result.clientDocumentRenewals.map((item) => (
                <article key={item.id} className={`renewal-card renewal-${item.status.toLowerCase()}`}>
                  <p className="eyebrow">{pretty(item.status)}</p>
                  <h3>
                    {item.client.legalFirstName} {item.client.legalLastName}: {item.templateName}
                  </h3>
                  <p>
                    <strong>Due {when(item.dueDate)}</strong> · {item.daysUntilDue < 0 ? `${Math.abs(item.daysUntilDue)} day(s) overdue` : `${item.daysUntilDue} day(s) remaining`}
                  </p>
                  {item.requests.map((request) => (
                    <div key={request.requestId}>
                      <p>
                        Request {pretty(request.status)} for {request.recipientName}
                        {request.latestFollowUpAt ? ` · last followed up ${when(request.latestFollowUpAt)}` : ""}
                      </p>
                      <a href={request.actionHref}>Open document request</a>
                    </div>
                  ))}
                  {item.workflow ? (
                    <p>
                      Renewal workflow: {pretty(item.workflow.status)}
                      {item.workflow.envelopeStatus ? ` · ${pretty(item.workflow.envelopeStatus)}` : ""}. The warning remains until completion.
                    </p>
                  ) : (
                    <p>Review and begin a new renewal cycle.</p>
                  )}
                  <a href={item.actionHref}>Open client renewal</a>
                </article>
              ))
            ) : (
              <div className="empty-state">No client document renewals are due soon or overdue for this authorized view.</div>
            )}
          </section>
          <section>
            <h2>Outstanding client document requests</h2>
            {result.clientDocumentRequests.length ? (
              result.clientDocumentRequests.map((item) => (
                <article key={item.requestId}>
                  <p className="eyebrow">
                    {pretty(item.status)} · {pretty(item.deadlineState)}
                  </p>
                  <h3>
                    {item.client.legalFirstName} {item.client.legalLastName}: {item.documentName}
                  </h3>
                  <p>
                    Requested from {item.recipientName} on {when(item.requestedAt)} · {when(item.dueAt)}
                  </p>
                  <p>
                    {item.followUpCount} follow-up(s)
                    {item.latestFollowUpAt ? ` · latest ${when(item.latestFollowUpAt)}` : ""}
                  </p>
                  <a href={item.actionHref}>Open document request</a>
                </article>
              ))
            ) : (
              <div className="empty-state">No standalone document requests are outstanding.</div>
            )}
          </section>
          <section>
            <h2>Evidence review queue</h2>
            {result.evidenceReview.length ? (
              result.evidenceReview.map((e) => (
                <article key={e.id}>
                  <h3>
                    {e.employee.firstName} {e.employee.lastName}: {e.title}
                  </h3>
                  <p>
                    {e.source} · submitted {when(e.submittedAt)} · {pretty(e.reviewState)}
                  </p>
                  <p>{e.requirementContext ?? "A reviewer must select the applicable requirement."}</p>
                  <strong>{e.reviewerActionAvailable ? "Authorized reviewer action available" : "Route to an authorized equivalency reviewer"}</strong>
                </article>
              ))
            ) : (
              <div className="empty-state">No external evidence currently awaits review.</div>
            )}
          </section>
          <section>
            <h2>Recent compliance activity</h2>
            {result.recentActivity.length ? (
              result.recentActivity.map((a) => (
                <article key={a.id}>
                  <strong>{pretty(a.eventType)}</strong>
                  <p>
                    {a.entityType} · {a.actor} · {when(a.occurredAt)}
                  </p>
                </article>
              ))
            ) : (
              <div className="empty-state">No recorded compliance activity is available.</div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
function Metric({ n, l }: { n: number; l: string }) {
  return (
    <div>
      <strong>{n}</strong>
      <span>{l}</span>
    </div>
  );
}
