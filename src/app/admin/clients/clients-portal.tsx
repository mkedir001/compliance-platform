"use client";
/* eslint-disable react-hooks/exhaustive-deps -- production organization context is fixed by the authenticated landing route */
import { FormEvent, useEffect, useState } from "react";
import GuidedIntake from "./guided-intake";

type RenewalCycle = {
  documentId: string;
  templateName: string;
  documentType: string;
  completedAt: string;
  dueDate: string;
  status: "CURRENT" | "DUE_SOON" | "OVERDUE";
  daysUntilDue: number;
  workflow: {
    documentId: string;
    status: string;
    envelopeStatus: string | null;
  } | null;
};
type RenewalSummary = {
  status: "CURRENT" | "DUE_SOON" | "OVERDUE";
  overdueCount: number;
  dueSoonCount: number;
  nearestDeadline: string | null;
  affectedTemplates: string[];
  cycles: RenewalCycle[];
};
type DocumentationRequirement={id:string;name:string;documentType:string;state:string;satisfied:boolean;reason:string;documentId:string|null;dueDate:string|null;daysUntilDue:number|null;deadlinePhase:string|null;signatureStatus:string|null;outstandingRequests:{id:string;status:string;recipientName:string;actionHref:string}[];actionHref:string};
type DocumentationReadiness={overallState:string;counts:{applicable:number;satisfied:number;current:number;missing:number;dueSoon:number;overdue:number;outstandingRequests:number;attentionNeeded:number;indeterminate:number};nearestActionableDeadline:string|null;highestPriorityIssue:DocumentationRequirement|null;requirements:DocumentationRequirement[];meaning:string};
type ClientRow = {
  id: string;
  status: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string | null;
  updatedAt: string;
  intakes: { status: string; currentStep: string }[];
  _count: { services: number; documents: number };
  renewalSummary: RenewalSummary;
  documentationReadiness: DocumentationReadiness;
};
type ClientDocument = {
  id: string;
  documentType: string;
  status: string;
  generatedAt: string;
  renewalOfDocumentId: string | null;
  envelope: { status: string } | null;
};
type ClientRepresentative = { id: string; representativeType: string; name: string; relationship: string | null; email: string | null };
type ClientDocumentRequest = { id: string; documentType: string; recipientType: string; recipientName: string; deliveryChannel: string; status: string; requestedAt: string | null; dueAt: string | null; latestFollowUpAt: string | null; followUpCount: number; obligationDocumentId: string | null; fulfilledDocumentId: string | null };
type ClientDetail = ClientRow & {
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  maPmiNumber: string | null;
  waiverProgram: string | null;
  financialResponsibility: string | null;
  primaryLanguage: string | null;
  interpreterNeeded: boolean;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  preferredCommunication: string | null;
  livingSituation: string | null;
  strengthsInterests: string | null;
  culturalPractices: string | null;
  supportNeeds: string | null;
  services: {id:string;serviceType:string;startDate:string|null;authorizedHours:number|null;status:"PROPOSED"|"ACTIVE"|"PAUSED"|"ENDED"|"CANCELLED"}[];
  representatives: ClientRepresentative[];
  emergencyContacts: {id:string;name:string;relationship:string;phone:string;alternatePhone:string|null;informationSharingAllowed:boolean}[];
  healthProfile: Record<string,string|null>|null;
  medications: {id:string;medication:string;dose:string|null;times:string|null;reason:string|null;prescriber:string|null}[];
  contacts: {
    professionalContact: { id:string;name: string; agency: string | null;contactType:string;email:string|null;phone:string|null };
    role: string;
  }[];
  documents: ClientDocument[];
  documentRequests: ClientDocumentRequest[];
  intakes:{status:string;currentStep:string;progressJson:unknown;lastSavedAt:string}[];
};
const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ");
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));

export default function ClientsPortal({ initialOrganizationId = "", initialClientId = "", initialDocumentId = "", initialRequestId = "", initialView = "", productionIdentity = false }: { initialOrganizationId?: string; initialClientId?: string; initialDocumentId?: string; initialRequestId?: string; initialView?:string; productionIdentity?: boolean }) {
  const [userId, setUserId] = useState(""),
    [organizationId, setOrganizationId] = useState(initialOrganizationId),
    [clients, setClients] = useState<ClientRow[]>([]),
    [selected, setSelected] = useState<ClientDetail | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [renewalStatus, setRenewalStatus] = useState(""),
    [readiness, setReadiness] = useState("ALL"),
    [permissions,setPermissions]=useState<string[]>([]),
    [tab, setTab] = useState("Overview"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const headers: Record<string, string> = productionIdentity ? { "content-type": "application/json" } : { "content-type": "application/json", "x-dev-user-id": userId };
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`/api/organizations/${organizationId}/clients${path}`, { ...init, headers: { ...headers, ...init?.headers } }),
      body = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.blob();
    if (!response.ok) throw new Error((body as { error?: string }).error ?? "Client operation failed");
    return body;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    await run(async () => {const[rows,accessResponse]=await Promise.all([request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}`),fetch(`/api/organizations/${organizationId}`,{headers})]),access=await accessResponse.json();if(!accessResponse.ok)throw new Error(access.error??"Organization access failed");setClients(rows as ClientRow[]);setPermissions(access.permissions??[])});
  }
  async function open(id: string) {
    await run(async () => setSelected((await request(`/${id}`)) as ClientDetail));
  }
  async function refresh(text: string) {
    if (!selected) return;
    setSelected((await request(`/${selected.id}`)) as ClientDetail);
    setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}`)) as ClientRow[]);
    setMessage(text);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    await run(async () => {
      const created = (await request("", {
        method: "POST",
        body: JSON.stringify({
          legalFirstName: data.get("legalFirstName"),
          legalLastName: data.get("legalLastName"),
          preferredName: data.get("preferredName") || undefined,
          dateOfBirth: data.get("dateOfBirth"),
          phone: data.get("phone") || undefined,
          email: data.get("email") || undefined,
          maPmiNumber: data.get("maPmiNumber") || undefined,
        }),
      })) as { client: ClientDetail };
      form.reset();
      await load();
      await open(created.client.id);
      setMessage("Client created and resumable intake started.");
    });
  }
  async function documentAction(body: unknown, text: string) {
    if (!selected) return;
    await run(async () => {
      await request(`/${selected.id}/documents`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh(text);
    });
  }
  async function guidedSave(next:ClientDetail,text:string){setSelected(next);setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}`)) as ClientRow[]);setMessage(text)}
  async function guidedGenerate(body:unknown,text:string){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/documents`,{method:"POST",headers,body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error??"Document generation failed");await open(selected.id);setMessage(text)}
  async function guidedComplete(){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/intake`,{method:"POST",headers,body:JSON.stringify({action:"COMPLETE"})}),result=await response.json();if(!response.ok)throw new Error(result.error??"Intake completion failed");await open(selected.id);setMessage("Intake review completed. Finalized document history remains immutable.")}
  async function requestAction(body: unknown, text: string) {
    if (!selected) return;
    await run(async () => {
      await request(`/${selected.id}/document-requests`, { method: "POST", body: JSON.stringify(body) });
      await refresh(text);
    });
  }
  async function createRequest(event: FormEvent<HTMLFormElement>, obligationDocumentId?: string) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      recipient = String(data.get("recipient")),
      representative = recipient.startsWith("representative:") ? recipient.slice(15) : undefined;
    await requestAction({ action: "CREATE", request: { documentType: data.get("documentType"), recipientType: representative ? "REPRESENTATIVE" : "CLIENT", representativeId: representative, deliveryChannel: data.get("deliveryChannel"), dueAt: obligationDocumentId ? undefined : data.get("dueAt") || undefined, obligationDocumentId } }, "Document request created. Review it before sending.");
    form.reset();
  }
  async function renewRoi(event: FormEvent<HTMLFormElement>, sourceDocumentId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await documentAction(
      {
        action: "RENEW_ROI",
        sourceDocumentId,
        roi: {
          direction: data.get("direction"),
          recipientName: data.get("recipientName"),
          categories: ["FACE_SHEET_CONTACT"],
          purposes: ["SERVICE_COORDINATION"],
          effectiveDate: data.get("effectiveDate"),
          expirationDate: data.get("expirationDate"),
        },
      },
      "Replacement ROI draft created with its own explicit expiration. Review it before collecting new signatures.",
    );
  }
  async function renewRights(event: FormEvent<HTMLFormElement>, sourceDocumentId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await documentAction(
      {
        action: "RENEW_RIGHTS",
        sourceDocumentId,
        formData: {
          writtenCopyReceivedDate: data.get("writtenCopyReceivedDate"),
          rightsExplainedDate: data.get("rightsExplainedDate"),
          explanationMethod: data.get("explanationMethod"),
          annualReviewDate: data.get("annualReviewDate") || undefined,
          grievanceContact: data.get("grievanceContact") || undefined,
          grievancePhoneEmail: data.get("grievancePhoneEmail") || undefined,
        },
      },
      "Rights renewal draft created from current client data and reviewed form values. Finalize it before collecting new signatures.",
    );
  }
  async function startSignature(event: FormEvent<HTMLFormElement>, documentId: string) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget),
      mode = String(data.get("mode"));
    await run(async () => {
      await request(`/${selected.id}/signatures`, {
        method: "POST",
        body: JSON.stringify({
          action: "CREATE",
          documentId,
          mode,
          signers: [
            {
              role: "CLIENT",
              name: data.get("clientName"),
              email: mode === "SEND_FOR_SIGNATURE" ? data.get("clientEmail") || undefined : undefined,
            },
            {
              role: "ORGANIZATION_STAFF",
              name: data.get("staffName"),
              email: mode === "SEND_FOR_SIGNATURE" ? data.get("staffEmail") || undefined : undefined,
            },
          ],
        }),
      });
      await refresh(mode === "SIGN_NOW" ? "Sign Now renewal envelope initiated." : "Renewal sent through the configured signature-provider boundary.");
    });
  }
  useEffect(() => {
    if (productionIdentity && organizationId) {
      void load();
      if (initialClientId) {
        setTab(initialDocumentId || initialRequestId || initialView==="Documents" ? "Documents" : initialView==="Readiness" ? "Readiness" : "Overview");
        void open(initialClientId);
      }
    }
  }, [productionIdentity, organizationId, initialClientId, initialDocumentId, initialRequestId, initialView]);
  useEffect(() => {
    if (selected && initialDocumentId && tab === "Documents") document.getElementById(`document-${initialDocumentId}`)?.scrollIntoView({ block: "center" });
  }, [selected, initialDocumentId, tab]);
  useEffect(() => {
    if (selected && initialRequestId && tab === "Documents") document.getElementById(`request-${initialRequestId}`)?.scrollIntoView({ block: "center" });
  }, [selected, initialRequestId, tab]);
  const tabs = ["Overview", "Readiness", "Intake", "Documents", "Signatures", "History"];
  return (
    <main className="admin-shell">
      <header>
        <p className="eyebrow">Client management</p>
        <h1>Clients, intake, and documents</h1>
        <p className="lede">Organization-scoped client records with resumable intake, immutable document history, and renewal management.</p>
      </header>
      {permissions.length?<nav className="experience-nav" aria-label="Management application"><a href={`/admin/clients?organizationId=${encodeURIComponent(organizationId)}`}>Clients</a>{permissions.includes("compliance.operations.read")?<a href={`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}`}>Compliance</a>:null}{permissions.includes("employee.read")?<a href={`/admin/workforce-onboarding?organizationId=${encodeURIComponent(organizationId)}`}>Workforce</a>:null}{permissions.includes("audit.session.manage")?<a href={`/admin/audit-access?organizationId=${encodeURIComponent(organizationId)}`}>Auditor access</a>:null}{permissions.includes("audit.read")?<a href={`/admin/reporting?organizationId=${encodeURIComponent(organizationId)}`}>Reporting</a>:null}</nav>:null}
      {!productionIdentity ? (
        <section className="portal-signin">
          <div className="auth">
            <label>
              User ID
              <input value={userId} onChange={(e) => setUserId(e.target.value)} />
            </label>
            <label>
              Organization ID
              <input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
            </label>
            <button onClick={load}>Open clients</button>
          </div>
        </section>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section>
        <div className="section-heading">
          <div>
            <h2>Client directory</h2>
            <p>List views intentionally omit health details.</p>
          </div>
          <div className="filters">
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              Client status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {["PROSPECTIVE", "INTAKE_IN_PROGRESS", "ACTIVE", "DISCHARGED", "ARCHIVED"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Renewals
              <select value={renewalStatus} onChange={(e) => setRenewalStatus(e.target.value)}>
                <option value="">All</option>
                <option value="CURRENT">Current</option>
                <option value="DUE_SOON">Due Soon</option>
                <option value="OVERDUE">Overdue</option>
              </select>
            </label>
            <label>
              Documentation readiness
              <select value={readiness} onChange={(e)=>setReadiness(e.target.value)}>
                <option value="ALL">All</option><option value="CURRENT">Ready / current</option><option value="ATTENTION_NEEDED">Attention needed</option><option value="MISSING">Missing documents</option><option value="DUE_SOON">Due soon</option><option value="OVERDUE">Overdue</option><option value="OUTSTANDING_REQUESTS">Outstanding requests</option>
              </select>
            </label>
            <button onClick={load}>Apply</button>
          </div>
        </div>
        {permissions.includes("client.create")?<details>
          <summary>Add client</summary>
          <form className="inline-form" onSubmit={create}>
            <label>
              Legal first name
              <input name="legalFirstName" required />
            </label>
            <label>
              Legal last name
              <input name="legalLastName" required />
            </label>
            <label>
              Preferred name
              <input name="preferredName" />
            </label>
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" required />
            </label>
            <label>
              Phone
              <input name="phone" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <label>
              MA/PMI
              <input name="maPmiNumber" />
            </label>
            <button disabled={busy}>Create and begin intake</button>
          </form>
        </details>:null}
        {clients.length ? (
          <div className="workforce-table" role="table">
            {clients.map((client) => (
              <button key={client.id} className={`workforce-row renewal-${client.documentationReadiness.overallState.toLowerCase()}`} onClick={() => open(client.id)}>
                <span>
                  <strong>
                    {client.legalLastName}, {client.preferredName ?? client.legalFirstName}
                  </strong>
                </span>
                <span>{pretty(client.status)}</span>
                <span className="renewal-badge">
                  Documentation: {pretty(client.documentationReadiness.overallState)}
                  <small>{client.documentationReadiness.counts.overdue} overdue · {client.documentationReadiness.counts.missing} missing · {client.documentationReadiness.counts.outstandingRequests} collection underway</small>
                  <small>{client.documentationReadiness.nearestActionableDeadline ? `Nearest ${date(client.documentationReadiness.nearestActionableDeadline)}` : "No determinable deadline"}</small>
                </span>
                <span>{client._count.documents} awaiting signature</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">No clients match this authorized view.</div>
        )}
      </section>
      {selected ? (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Client record</p>
              <h2>
                {selected.legalFirstName} {selected.legalLastName}
              </h2>
              <p>
                {pretty(selected.status)} · documentation <strong>{pretty(selected.documentationReadiness.overallState)}</strong>
              </p>
            </div>
          </div>
          <nav className="admin-nav" aria-label="Client record">
            {tabs.map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </nav>
          {tab === "Overview" ? (
            <article>
              <h3>Operational summary</h3>
              <p>
                {selected.services.length} service(s) · {selected.contacts.find((x) => x.role === "CASE_MANAGER")?.professionalContact.name ?? "No case manager selected"} · {selected.documents.filter((x) => ["READY_FOR_SIGNATURE", "PARTIALLY_SIGNED"].includes(x.status)).length} document(s) awaiting signature
              </p>
              <p>
                {selected.renewalSummary.overdueCount} renewal(s) overdue · {selected.renewalSummary.dueSoonCount} due soon
              </p>
            </article>
          ) : null}
          {tab === "Readiness" ? <section className="renewal-panel"><h3>Documentation readiness</h3><p><strong>{pretty(selected.documentationReadiness.overallState)}</strong> · {selected.documentationReadiness.counts.satisfied} of {selected.documentationReadiness.counts.applicable} applicable requirement(s) currently satisfied</p><p>{selected.documentationReadiness.counts.missing} missing · {selected.documentationReadiness.counts.dueSoon} due soon · {selected.documentationReadiness.counts.overdue} overdue · {selected.documentationReadiness.counts.outstandingRequests} with collection underway</p><p>{selected.documentationReadiness.meaning}</p>{selected.documentationReadiness.requirements.map(item=><article key={item.id}><p className="eyebrow">{pretty(item.state)}{item.deadlinePhase?` · ${pretty(item.deadlinePhase)}`:""}</p><h4>{item.name}</h4><p>{item.reason}</p><p>{item.dueDate?`Due ${date(item.dueDate)}`:"No determinable deadline"}{item.signatureStatus?` · signature ${pretty(item.signatureStatus)}`:""}</p>{item.outstandingRequests.map(request=><p key={request.id}>Collection request {pretty(request.status)} for {request.recipientName}. <a href={request.actionHref}>Open request</a></p>)}<a href={item.actionHref}>Open document workflow</a></article>)}</section> : null}
          {tab === "Intake" ? permissions.includes("client.intake.manage")?<GuidedIntake client={selected} organizationId={organizationId} headers={headers} canGenerate={permissions.includes("client.document.generate")} canReadDocuments={permissions.includes("client.document.read")} canSign={permissions.includes("client.signature.manage")} onSaved={(next,text)=>guidedSave(next as ClientDetail,text)} onGenerate={guidedGenerate} onComplete={guidedComplete}/>:<article><h3>Guided intake</h3><p>Your current permissions allow client review but not intake changes.</p></article> : null}
          {tab === "Documents" ? (
            <>
              <section className="renewal-panel">
                <h3>Document requests</h3>
                {permissions.includes("client.document.generate")?<details>
                  <summary>Create document request</summary>
                  <form className="inline-form" onSubmit={(event) => createRequest(event)}>
                    <label>
                      Document
                      <select name="documentType">
                        {["INTAKE_CHECKLIST", "FACE_SHEET", "RIGHTS_ACKNOWLEDGMENT", "ROI"].map((value) => (
                          <option key={value} value={value}>
                            {pretty(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Recipient
                      <select name="recipient">
                        <option value="client">Client</option>
                        {selected.representatives.map((row) => (
                          <option key={row.id} value={`representative:${row.id}`}>
                            {row.name} · {pretty(row.representativeType)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Delivery
                      <select name="deliveryChannel">
                        <option value="EMAIL">Email</option>
                        <option value="MANUAL">Manual follow-up</option>
                        <option value="SIGN_NOW">Sign Now</option>
                      </select>
                    </label>
                    <label>
                      Due date
                      <input name="dueAt" type="date" />
                    </label>
                    <button disabled={busy}>Create request</button>
                  </form>
                </details>:null}
                {selected.documentRequests.length ? (
                  selected.documentRequests.map((item) => (
                    <article id={`request-${item.id}`} key={item.id}>
                      <p className="eyebrow">
                        {pretty(item.status)} · {pretty(item.deliveryChannel)}
                      </p>
                      <h4>{pretty(item.documentType)}</h4>
                      <p>
                        Recipient: {item.recipientName} · requested {item.requestedAt ? date(item.requestedAt) : "not sent"} · due {item.dueAt ? date(item.dueAt) : "not specified"}
                      </p>
                      <p>
                        {item.followUpCount} follow-up(s){item.latestFollowUpAt ? ` · latest ${date(item.latestFollowUpAt)}` : ""}
                        {item.fulfilledDocumentId ? " · fulfilled" : ""}
                      </p>
                      {permissions.includes("client.document.generate")&&["DRAFT", "SENT", "OUTSTANDING"].includes(item.status) ? (
                        <div>
                          {item.status === "DRAFT" ? (
                            <button disabled={busy} onClick={() => requestAction({ action: "SEND", requestId: item.id }, "Document request sent and is now outstanding.")}>
                              Send request
                            </button>
                          ) : null}
                          {item.status === "OUTSTANDING" ? (
                            <button disabled={busy} onClick={() => requestAction({ action: "FOLLOW_UP", requestId: item.id }, "Document request follow-up recorded.")}>
                              Follow up
                            </button>
                          ) : null}
                          <button disabled={busy} onClick={() => requestAction({ action: "CANCEL", requestId: item.id }, "Document request canceled; the underlying requirement remains unchanged.")}>
                            Cancel request
                          </button>
                          <label>
                            Fulfill with existing completed document
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                if (event.target.value) void requestAction({ action: "LINK_FULFILLMENT", requestId: item.id, documentId: event.target.value }, "Document linked and request reconciled.");
                              }}
                            >
                              <option value="">Select document</option>
                              {selected.documents
                                .filter((document) => document.documentType === item.documentType && document.status === "COMPLETED")
                                .map((document) => (
                                  <option key={document.id} value={document.id}>
                                    {pretty(document.documentType)} · {date(document.generatedAt)}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p>No document requests have been recorded.</p>
                )}
              </section>
              <section className="renewal-panel">
                <h3>Document renewals</h3>
                {selected.renewalSummary.cycles.length ? (
                  selected.renewalSummary.cycles.map((cycle) => (
                    <article id={`document-${cycle.documentId}`} key={cycle.documentId} className={`renewal-card renewal-${cycle.status.toLowerCase()}`}>
                      <p className="eyebrow">{pretty(cycle.status)}</p>
                      <h4>{cycle.templateName}</h4>
                      <p>
                        Completed {date(cycle.completedAt)} · renewal due {date(cycle.dueDate)} · {cycle.daysUntilDue < 0 ? `${Math.abs(cycle.daysUntilDue)} day(s) overdue` : `${cycle.daysUntilDue} day(s) until due`}
                      </p>
                      {permissions.includes("client.document.generate")&&!cycle.workflow ? (
                        <details>
                          <summary>Request this renewal document</summary>
                          <form className="inline-form" onSubmit={(event) => createRequest(event, cycle.documentId)}>
                            <input type="hidden" name="documentType" value={cycle.documentType} />
                            <label>
                              Recipient
                              <select name="recipient">
                                <option value="client">Client</option>
                                {selected.representatives.map((row) => (
                                  <option key={row.id} value={`representative:${row.id}`}>
                                    {row.name} · {pretty(row.representativeType)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Delivery
                              <select name="deliveryChannel">
                                <option value="EMAIL">Email</option>
                                <option value="MANUAL">Manual follow-up</option>
                                <option value="SIGN_NOW">Sign Now</option>
                              </select>
                            </label>
                            <button disabled={busy}>Create renewal request</button>
                          </form>
                        </details>
                      ) : null}
                      {cycle.workflow ? (
                        <p>
                          Renewal workflow: <strong>{pretty(cycle.workflow.status)}</strong>
                          {cycle.workflow.envelopeStatus ? ` · ${pretty(cycle.workflow.envelopeStatus)}` : ""}
                        </p>
                      ) : permissions.includes("client.document.generate")&&cycle.documentType === "RIGHTS_ACKNOWLEDGMENT" ? (
                        <details>
                          <summary>Review / Renew Rights</summary>
                          <form className="inline-form" onSubmit={(event) => renewRights(event, cycle.documentId)}>
                            <label>
                              Written copy received
                              <input name="writtenCopyReceivedDate" type="date" required />
                            </label>
                            <label>
                              Rights explained
                              <input name="rightsExplainedDate" type="date" required />
                            </label>
                            <label>
                              Explanation method
                              <select name="explanationMethod">
                                <option value="IN_PERSON">In person</option>
                                <option value="PHONE_VIDEO">Phone / video</option>
                                <option value="INTERPRETER">Interpreter</option>
                                <option value="EASY_READ_VISUAL">Easy-read / visual</option>
                                <option value="OTHER">Other</option>
                              </select>
                            </label>
                            <label>
                              Annual review date
                              <input name="annualReviewDate" type="date" />
                            </label>
                            <label>
                              Grievance contact
                              <input name="grievanceContact" />
                            </label>
                            <label>
                              Grievance phone/email
                              <input name="grievancePhoneEmail" />
                            </label>
                            <button disabled={busy}>Create renewal draft</button>
                          </form>
                        </details>
                      ) : permissions.includes("client.document.generate") ? (
                        <details>
                          <summary>Review / Renew ROI</summary>
                          <form className="inline-form" onSubmit={(event) => renewRoi(event, cycle.documentId)}>
                            <label>
                              Direction
                              <select name="direction">
                                <option value="BOTH">Both</option>
                                <option value="RELEASE_TO">Release to</option>
                                <option value="RECEIVE_FROM">Receive from</option>
                              </select>
                            </label>
                            <label>
                              Recipient
                              <input name="recipientName" required />
                            </label>
                            <label>
                              Effective date
                              <input name="effectiveDate" type="date" required />
                            </label>
                            <label>
                              Expiration date
                              <input name="expirationDate" type="date" required />
                            </label>
                            <button disabled={busy}>Create renewal draft</button>
                          </form>
                        </details>
                      ):null}
                    </article>
                  ))
                ) : (
                  <p>No completed documents currently carry an automatic renewal policy.</p>
                )}
              </section>
              {permissions.includes("client.document.generate")?<div>
                <button onClick={() => documentAction({ action: "GENERATE", documentType: "FACE_SHEET" }, "Face Sheet generated.")}>Generate Face Sheet</button>
                <button
                  onClick={() =>
                    documentAction(
                      {
                        action: "GENERATE",
                        documentType: "RIGHTS_ACKNOWLEDGMENT",
                      },
                      "Rights acknowledgment generated.",
                    )
                  }
                >
                  Generate Rights acknowledgment
                </button>
                <button onClick={() => documentAction({ action: "GENERATE", documentType: "INTAKE_CHECKLIST" }, "Intake Checklist generated.")}>Generate Intake Checklist</button>
              </div>:null}
              {selected.documents.map((document) => (
                <article key={document.id}>
                  <strong>{pretty(document.documentType)}</strong>
                  {document.renewalOfDocumentId ? <span className="renewal-badge"> Renewal cycle</span> : null}
                  <p>
                    {pretty(document.status)} · {new Date(document.generatedAt).toLocaleString()}
                  </p>
                  {permissions.includes("client.document.read")?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${document.id}`}>Preview / download PDF</a>:null}
                  {permissions.includes("client.document.generate")&&document.status === "DRAFT" ? (
                    <button disabled={busy} onClick={() => documentAction({ action: "FINALIZE", documentId: document.id }, "Document is ready for a new signature workflow.")}>
                      Ready for Signature
                    </button>
                  ) : null}
                  {permissions.includes("client.signature.manage")&&document.status === "READY_FOR_SIGNATURE" && !document.envelope ? (
                    <form className="inline-form" onSubmit={(event) => startSignature(event, document.id)}>
                      <label>
                        Client/signer name
                        <input name="clientName" defaultValue={`${selected.legalFirstName} ${selected.legalLastName}`} required />
                      </label>
                      <label>
                        Client email (remote)
                        <input name="clientEmail" type="email" />
                      </label>
                      <label>
                        Staff signer name
                        <input name="staffName" required />
                      </label>
                      <label>
                        Staff email (remote)
                        <input name="staffEmail" type="email" />
                      </label>
                      <label>
                        Workflow
                        <select name="mode">
                          <option value="SIGN_NOW">Sign Now</option>
                          <option value="SEND_FOR_SIGNATURE">Send for Signature</option>
                        </select>
                      </label>
                      <button disabled={busy}>Start signature workflow</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </>
          ) : null}
          {tab === "Signatures" ? (
            <pre className="data-preview">
              {JSON.stringify(
                selected.documents.map((x) => ({
                  document: x.documentType,
                  status: x.status,
                  envelope: x.envelope,
                })),
                null,
                2,
              )}
            </pre>
          ) : null}
          {tab === "History" ? <p>Historical completed documents and signatures remain immutable. Material renewal, signature, ROI, and export actions are preserved in the tenant audit stream.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
