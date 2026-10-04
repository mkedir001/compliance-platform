"use client";
/* eslint-disable react-hooks/exhaustive-deps -- production organization context is fixed by the authenticated landing route */
import { FormEvent, useEffect, useState } from "react";
import GuidedIntake from "./guided-intake";
import ClientImportWorkflow from "./client-import-workflow";
import { clientDirectoryView, type ClientDirectoryLoadStatus } from "./directory-state";
import type { IntakeStepId } from "@/domain/clients/intake-state";

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
  intakes: { status: string; currentStep: string; progressJson:unknown }[];
  services: {id:string;serviceType:string;startDate:string|null;authorizedHours:number|null;authorizationStart:string|null;authorizationEnd:string|null;scheduleJson:Record<string,unknown>|null;status:"PROPOSED"|"ACTIVE"|"PAUSED"|"ENDED"|"CANCELLED"}[];
  _count: { documents: number; documentRequests:number; importSessions:number };
  renewalSummary: RenewalSummary;
  documentationReadiness: DocumentationReadiness;
};
type ClientDocument = {
  id: string;
  documentType: string;
  status: string;
  source: "GENERATED"|"IMPORTED";
  originalFileName: string|null;
  importedAt: string|null;
  generatedAt: string;
  invitationLifetimeHours:number;
  renewalOfDocumentId: string | null;
  isCurrentActionable:boolean;
  isHistoricalDuplicate:boolean;
  signatureIntegrityIssue:boolean;
  template:{name:string;versionNumber:number};
  signatureRequirements:{key:string;label:string;allowedRoles:string[];allowedMethods:("SIGN_NOW"|"SEND_FOR_SIGNATURE")[];candidates:{role:string;name:string;email:string|null;source:string}[]}[];
  envelope: { id:string;status:string;mode:string;sentAt:string|null;completedAt:string|null;voidReason:string|null;signers:{id:string;role:string;name:string;email:string|null;status:string;sentAt:string|null;viewedAt:string|null;signedAt:string|null;signatureMethod:string|null;verificationMethod:string|null;invitations:{id:string;status:string;deliveryStatus:"PENDING"|"ACCEPTED"|"FAILED";deliveryAttempts:number;deliveryAttemptedAt:string|null;createdAt:string;providerAcceptedAt:string|null;deliveredAt:string|null;expiresAt:string;usedAt:string|null;revokedAt:string|null}[]}[] } | null;
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
  importSessions:{id:string;status:string;target:string;confirmedAt:string|null;canceledAt:string|null;createdAt:string;updatedAt:string;_count:{documents:number;proposals:number}}[];
  history:{id:string;eventType:string;entityType:string;entityId:string;occurredAt:string;actor:{email:string}|null;metadataJson:unknown}[];
};
const pretty = (value: string) => value.toLowerCase().replaceAll("_", " ");
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
type PreparedSigner={role:string;name:string;email?:string};
function invitationState(signer:NonNullable<ClientDocument["envelope"]>["signers"][number]){if(signer.status==="SIGNED")return"SIGNED";const latest=signer.invitations[0];if(!latest)return"AWAITING DELIVERY";if(latest.status==="ACTIVE"&&new Date(latest.expiresAt)<=new Date())return"EXPIRED";if(latest.status==="ACTIVE"&&latest.deliveryStatus==="FAILED")return"EMAIL DELIVERY FAILED";if(latest.status==="ACTIVE")return latest.deliveryStatus==="ACCEPTED"?"AWAITING SIGNATURE":"AWAITING DELIVERY";return latest.status}
function signatureProgress(document:ClientDocument){const signers=document.envelope?.signers??[],completed=signers.filter(signer=>signer.status==="SIGNED").length;return{signers,completed,pending:signers.length-completed,total:signers.length}}
function SignatureWorkflowPanel({document,busy,onStart}:{document:ClientDocument;busy:boolean;onStart:(requirementIndex:number,method:"SIGN_NOW"|"SEND_FOR_SIGNATURE",signers:PreparedSigner[],confirmed:boolean)=>Promise<void>}){const requirements=document.signatureRequirements,[selected,setSelected]=useState(()=>requirements.map(()=>0)),[names,setNames]=useState(()=>requirements.map(requirement=>requirement.candidates[0]?.name??"")),[emails,setEmails]=useState(()=>requirements.map(requirement=>requirement.candidates[0]?.email??"")),[remoteIndex,setRemoteIndex]=useState<number|null>(null);function signer(index:number){const requirement=requirements[index],candidate=requirement.candidates[selected[index]];return{role:candidate?.role??requirement.allowedRoles[0],name:(names[index]?.trim()||candidate?.name)??"",email:emails[index]?.trim()||undefined}}function roster(){return requirements.map((_,index)=>signer(index))}function updateCandidate(index:number,value:number){const candidate=requirements[index].candidates[value],next=[...selected],nextNames=[...names],nextEmails=[...emails];next[index]=value;nextNames[index]=candidate?.name??"";nextEmails[index]=candidate?.email??"";setSelected(next);setNames(nextNames);setEmails(nextEmails);setRemoteIndex(null)}const rosterReady=requirements.every((_,index)=>signer(index).name);return <div className="signature-workflow"><h5>Required signatures</h5><div className="signer-roster">{requirements.map((requirement,index)=>{const candidate=requirement.candidates[selected[index]],row=signer(index);return <section className="signer-requirement" key={requirement.key}><div><h6>{requirement.label}</h6>{requirement.candidates.length>1?<label>Intended signer<select value={selected[index]} onChange={event=>updateCandidate(index,Number(event.target.value))}>{requirement.candidates.map((option,optionIndex)=><option key={`${option.role}:${option.name}`} value={optionIndex}>{option.name} — {pretty(option.role)}</option>)}</select></label>:<p>{row.name?<strong>{row.name}</strong>:"Identity will be confirmed in the signing ceremony"}<br/><small>Pending</small></p>}</div><div className="signature-actions">{requirement.allowedMethods.includes("SIGN_NOW")?<button type="button" disabled={busy} onClick={()=>void onStart(index,"SIGN_NOW",roster(),false)}>Sign now</button>:null}{requirement.allowedMethods.includes("SEND_FOR_SIGNATURE")?<button type="button" className="secondary" disabled={busy||!candidate} onClick={()=>setRemoteIndex(index)}>Send for signature</button>:null}</div></section>})}</div>{remoteIndex!==null?<section className="send-review" aria-label="Send for signature review"><h5>{`Send for signature — ${requirements[remoteIndex].label}`}</h5>{requirements.map((requirement,index)=>!signer(index).name?<label key={requirement.key}>Confirm {requirement.label} name<input value={names[index]} onChange={event=>{const next=[...names];next[index]=event.target.value;setNames(next)}} required/></label>:null)}<label>Recipient name<input value={names[remoteIndex]} onChange={event=>{const next=[...names];next[remoteIndex]=event.target.value;setNames(next)}} required/></label><label>Delivery email<input type="email" value={emails[remoteIndex]} onChange={event=>{const next=[...emails];next[remoteIndex]=event.target.value;setEmails(next)}} required/></label><p>Invitation expires after {document.invitationLifetimeHours} hours. The recipient will review the current authoritative rendition.</p><div className="signature-actions"><button type="button" disabled={busy||!rosterReady||!emails[remoteIndex]} onClick={()=>onStart(remoteIndex,"SEND_FOR_SIGNATURE",roster(),true)}>Send invitation</button><button type="button" className="secondary" onClick={()=>setRemoteIndex(null)}>Cancel</button></div></section>:null}</div>}

export default function ClientsPortal({ initialOrganizationId = "", initialClientId = "", initialDocumentId = "", initialRequestId = "", initialView = "", productionIdentity = false }: { initialOrganizationId?: string; initialClientId?: string; initialDocumentId?: string; initialRequestId?: string; initialView?:string; productionIdentity?: boolean }) {
  const [userId, setUserId] = useState(""),
    [organizationId, setOrganizationId] = useState(initialOrganizationId),
    [clients, setClients] = useState<ClientRow[]>([]),
    [selected, setSelected] = useState<ClientDetail | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [renewalStatus, setRenewalStatus] = useState(""),
    [readiness, setReadiness] = useState("ALL"),
    [operational, setOperational] = useState(""),
    [permissions,setPermissions]=useState<string[]>([]),
    [directoryStatus,setDirectoryStatus]=useState<ClientDirectoryLoadStatus>("idle"),
    [tab, setTab] = useState("Overview"),
    [editingCompletedIntake,setEditingCompletedIntake]=useState(false),
    [editStartStep,setEditStartStep]=useState<IntakeStepId>("CLIENT"),
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
    setDirectoryStatus("loading");
    await run(async () => {try{const[rows,accessResponse]=await Promise.all([request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`),fetch(`/api/organizations/${organizationId}`,{headers})]),access=await accessResponse.json();if(!accessResponse.ok)throw new Error(access.error??"Organization access failed");setClients(rows as ClientRow[]);setPermissions(access.permissions??[]);setDirectoryStatus("success")}catch(error){setDirectoryStatus("error");throw error}});
  }
  async function open(id: string) {
    await run(async () => setSelected((await request(`/${id}`)) as ClientDetail));
  }
  async function refresh(text: string) {
    if (!selected) return;
    setSelected((await request(`/${selected.id}`)) as ClientDetail);
    setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`)) as ClientRow[]);
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
  async function guidedSave(next:ClientDetail,text:string){setSelected(next);setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`)) as ClientRow[]);setMessage(text)}
  async function changeLifecycle(nextStatus:"ACTIVE"|"DISCHARGED"|"ARCHIVED"){if(!selected)return;const reason=window.prompt(`Reason for changing this client to ${pretty(nextStatus)}`)?.trim();if(!reason)return;await run(async()=>{const next=await request(`/${selected.id}`,{method:"PATCH",body:JSON.stringify({status:nextStatus,reason})}) as ClientDetail;setSelected(next);await refresh(`Client lifecycle changed to ${pretty(nextStatus)}. Historical records were preserved.`)})}
  async function guidedGenerate(body:unknown,text:string){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/documents`,{method:"POST",headers,body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error??"Document generation failed");await open(selected.id);setMessage(text)}
  async function guidedComplete(){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/intake`,{method:"POST",headers,body:JSON.stringify({action:"COMPLETE"})}),result=await response.json();if(!response.ok){const error=new Error(result.error??"Intake completion failed") as Error&{details?:unknown};error.details=result.details;throw error}await open(selected.id);setTab("Documents");setMessage(result.alreadyCompleted?"Intake was already complete. Continue with the current document workflow.":"Intake review completed. Review and finalize the current drafts before starting signatures.")}
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
  async function startSignature(documentId:string,requirementIndex:number,method:"SIGN_NOW"|"SEND_FOR_SIGNATURE",signers:PreparedSigner[],confirmed:boolean) {
    if (!selected) return;
    await run(async () => {
      const created=await request(`/${selected.id}/signatures`, {
        method: "POST",
        body: JSON.stringify({
          action: "START_SIGNER_ACTION",
          documentId,
          requirementIndex,
          method,
          signers,
          confirmed,
        }),
      });
      const result=created as {url?:string};if(method==="SIGN_NOW"&&result.url){window.location.assign(result.url);return}await refresh("Secure signing invitation sent through the configured delivery adapter.");
    });
  }
  async function importDocument(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selected)return;const form=event.currentTarget,data=new FormData(form),file=data.get("file");if(!(file instanceof File)||!file.size){setMessage("Select a PDF to import.");return}await run(async()=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));await request(`/${selected.id}/documents`,{method:"POST",body:JSON.stringify({action:"IMPORT",document:{documentType:data.get("documentType"),fileName:file.name,pdfBase64:btoa(binary),disposition:data.get("disposition"),completedAt:data.get("completedAt")||undefined}})});form.reset();await refresh(data.get("disposition")==="HISTORICAL_COMPLETE"?"Completed historical PDF preserved without a new signing request.":"Imported PDF preserved and prepared for the native signing workflow.")})}
  async function signatureAction(body:unknown,text:string,openUrl=false){if(!selected)return;await run(async()=>{const result=await request(`/${selected.id}/signatures`,{method:"POST",body:JSON.stringify(body)}) as {url?:string};if(openUrl&&result.url){window.location.assign(result.url);return}await refresh(text)})}
  function editCompletedIntake(step:IntakeStepId){setEditStartStep(step);setEditingCompletedIntake(true);setTab("Intake")}
  useEffect(() => {
    if (productionIdentity && organizationId) {
      void load();
      if (initialClientId) {
        setTab(initialDocumentId || initialRequestId || initialView==="Documents" ? "Documents" : initialView==="Signatures" ? "Signatures" : initialView==="Readiness" ? "Readiness" : "Overview");
        void open(initialClientId);
      }
    }
  }, [productionIdentity, organizationId, initialClientId, initialDocumentId, initialRequestId, initialView]);
  useEffect(() => {
    if (!selected) return;
    const revalidate = () => { if (document.visibilityState === "visible") void open(selected.id); };
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => { window.removeEventListener("pageshow", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [selected?.id, organizationId]);
  useEffect(() => {
    if (selected && initialDocumentId && tab === "Documents") document.getElementById(`document-${initialDocumentId}`)?.scrollIntoView({ block: "center" });
  }, [selected, initialDocumentId, tab]);
  useEffect(() => {
    if (selected && initialRequestId && tab === "Documents") document.getElementById(`request-${initialRequestId}`)?.scrollIntoView({ block: "center" });
  }, [selected, initialRequestId, tab]);
  const tabs = ["Overview", "Intake", "Services", "Documents", "Signatures", "Readiness", "Contacts", "History"];
  const directoryView = clientDirectoryView(directoryStatus, clients.length);
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
            <label>
              Operational attention
              <select value={operational} onChange={(e)=>setOperational(e.target.value)}>
                <option value="">All</option>
                <option value="OUTSTANDING_SIGNATURE">Outstanding signature</option>
                <option value="OUTSTANDING_REQUEST">Outstanding document request</option>
                <option value="IMPORTED_HISTORY">Imported history</option>
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
        {permissions.includes("client.create")&&permissions.includes("client.update")?<ClientImportWorkflow organizationId={organizationId} headers={headers} busy={busy} onBusy={setBusy} onComplete={async clientId=>{await load();await open(clientId)}}/>:null}
        {directoryView === "results" ? (
          <div className="workforce-table client-directory" role="table" aria-label="Client directory">
            {clients.map((client) => (
              <button key={client.id} className={`workforce-row client-directory-row renewal-${client.documentationReadiness.overallState.toLowerCase()}`} onClick={() => open(client.id)}>
                <span>
                  <strong>
                    {client.legalLastName}, {client.preferredName ?? client.legalFirstName}
                  </strong>
                </span>
                <span>{pretty(client.status)}</span>
                <span><strong>{client.intakes[0]?.status?pretty(client.intakes[0].status):"No intake"}</strong><small>{client.intakes[0]?client.intakes[0].status==="COMPLETED"?"Intake complete":`Next: ${pretty(client.intakes[0].currentStep)}`:"No guided intake record"}</small></span>
                <span><strong>{client.services.length?client.services.map(item=>pretty(item.serviceType)).join(", "):"No current services"}</strong><small>{client.services.map(item=>pretty(item.status)).join(", ")}</small></span>
                <span className="renewal-badge">
                  Documentation: {pretty(client.documentationReadiness.overallState)}
                  <small>{client.documentationReadiness.counts.overdue} overdue · {client.documentationReadiness.counts.missing} missing · {client.documentationReadiness.counts.outstandingRequests} collection underway</small>
                  <small>{client.documentationReadiness.nearestActionableDeadline ? `Nearest ${date(client.documentationReadiness.nearestActionableDeadline)}` : "No determinable deadline"}</small>
                </span>
                <span>{client._count.documents} awaiting signature<small>{client._count.documentRequests} outstanding request(s) · {client._count.importSessions} confirmed import(s)</small></span>
              </button>
            ))}
          </div>
        ) : directoryView === "empty" ? (
          <div className="empty-state">No clients match this authorized view.</div>
        ) : directoryView === "error" ? (
          <div className="empty-state" role="alert">
            <strong>Client directory unavailable</strong>
            <p>The authorized client query failed. Existing records may be temporarily inaccessible; this is not a zero-client result.</p>
            <button type="button" disabled={busy} onClick={load}>Retry client directory</button>
          </div>
        ) : (
          <div className="empty-state" role="status">Loading authorized clients…</div>
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
            <section>
              <article><p className="eyebrow">Lifecycle</p><h3>{pretty(selected.status)}</h3><p>{selected.intakes[0]?.status==="COMPLETED"?"Guided intake completed.":`Intake ${pretty(selected.intakes[0]?.status??"not started")} · next ${pretty(selected.intakes[0]?.currentStep??"client")}.`}</p>{permissions.includes("client.update")?<div className="signature-actions">{selected.intakes[0]?.status==="COMPLETED"&&selected.status!=="ACTIVE"&&selected.status!=="ARCHIVED"?<button disabled={busy} onClick={()=>changeLifecycle("ACTIVE")}>Activate client</button>:null}{selected.status==="ACTIVE"||selected.status==="INTAKE_IN_PROGRESS"?<button className="secondary" disabled={busy} onClick={()=>changeLifecycle("DISCHARGED")}>Discharge client</button>:null}{selected.status==="DISCHARGED"?<button className="secondary" disabled={busy} onClick={()=>changeLifecycle("ARCHIVED")}>Archive closed record</button>:null}</div>:null}</article>
              <article><p className="eyebrow">Operational attention</p><h3>{selected.documentationReadiness.highestPriorityIssue?.name??"No documentation issue"}</h3><p>{selected.documentationReadiness.highestPriorityIssue?.reason??selected.documentationReadiness.meaning}</p><div className="signature-actions">{selected.intakes[0]?.status!=="COMPLETED"?<button onClick={()=>setTab("Intake")}>Resume intake</button>:null}{selected.documentationReadiness.highestPriorityIssue?<button onClick={()=>setTab("Readiness")}>Resolve documentation issue</button>:null}{selected.documents.some(item=>["READY_FOR_SIGNATURE","PARTIALLY_SIGNED"].includes(item.status))?<button onClick={()=>setTab("Signatures")}>Review signature progress</button>:null}{selected.documentRequests.some(item=>["SENT","OUTSTANDING"].includes(item.status))?<button onClick={()=>setTab("Documents")}>Review document requests</button>:null}</div></article>
              <article><h3>Current operations</h3><p>{selected.services.filter(item=>item.status==="ACTIVE").length} active service(s) · {selected.contacts.find((x) => x.role === "CASE_MANAGER")?.professionalContact.name ?? "No case manager selected"} · {selected.documents.filter((x) => ["READY_FOR_SIGNATURE", "PARTIALLY_SIGNED"].includes(x.status)).length} document(s) awaiting signature</p><p>{selected.renewalSummary.overdueCount} renewal(s) overdue · {selected.renewalSummary.dueSoonCount} due soon · {selected.documentRequests.filter(item=>["SENT","OUTSTANDING"].includes(item.status)).length} outstanding request(s)</p></article>
              {permissions.includes("client.update")?<ClientImportWorkflow organizationId={organizationId} headers={headers} busy={busy} onBusy={setBusy} existingClientId={selected.id} onComplete={async()=>{await open(selected.id);await load()}}/>:null}
            </section>
          ) : null}
          {tab === "Readiness" ? <section className="renewal-panel"><h3>Documentation readiness</h3><p><strong>{pretty(selected.documentationReadiness.overallState)}</strong> · {selected.documentationReadiness.counts.satisfied} of {selected.documentationReadiness.counts.applicable} applicable requirement(s) currently satisfied</p><p>{selected.documentationReadiness.counts.missing} missing · {selected.documentationReadiness.counts.dueSoon} due soon · {selected.documentationReadiness.counts.overdue} overdue · {selected.documentationReadiness.counts.outstandingRequests} with collection underway</p><p>{selected.documentationReadiness.meaning}</p>{selected.documentationReadiness.requirements.map(item=><article key={item.id}><p className="eyebrow">{pretty(item.state)}{item.deadlinePhase?` · ${pretty(item.deadlinePhase)}`:""}</p><h4>{item.name}</h4><p>{item.reason}</p><p>{item.dueDate?`Due ${date(item.dueDate)}`:"No determinable deadline"}{item.signatureStatus?` · signature ${pretty(item.signatureStatus)}`:""}</p>{item.outstandingRequests.map(request=><p key={request.id}>Collection request {pretty(request.status)} for {request.recipientName}. <a href={request.actionHref}>Open request</a></p>)}<a href={item.actionHref}>Open document workflow</a></article>)}</section> : null}
          {tab === "Intake" ? permissions.includes("client.intake.manage")?(selected.intakes[0]?.status==="COMPLETED"?(editingCompletedIntake?<GuidedIntake client={selected} organizationId={organizationId} headers={headers} canGenerate={permissions.includes("client.document.generate")} canReadDocuments={permissions.includes("client.document.read")} canSign={permissions.includes("client.signature.manage")} updateMode initialStep={editStartStep} onSaved={(next,text)=>guidedSave(next as ClientDetail,text)} onGenerate={guidedGenerate} onComplete={guidedComplete} onFinishUpdate={()=>{setEditingCompletedIntake(false);setTab(editStartStep==="SERVICES"?"Services":"Overview");setMessage("Client information updated. Completed intake evidence and prior documents were preserved.")}}/>:<article><h3>Guided intake completed</h3><p>The initial intake completion is preserved. Authorized staff may update current client information without changing completed intake evidence or immutable document snapshots.</p><div className="action-group"><button onClick={()=>editCompletedIntake("CLIENT")}>Update client information</button><button className="secondary" onClick={()=>setTab("Documents")}>Open Documents</button></div></article>):<GuidedIntake client={selected} organizationId={organizationId} headers={headers} canGenerate={permissions.includes("client.document.generate")} canReadDocuments={permissions.includes("client.document.read")} canSign={permissions.includes("client.signature.manage")} onSaved={(next,text)=>guidedSave(next as ClientDetail,text)} onGenerate={guidedGenerate} onComplete={guidedComplete}/>):<article><h3>Guided intake</h3><p>Your current permissions allow client review but not intake changes.</p></article> : null}
          {tab === "Services" ? <section><h3>Services</h3><p>Service information is shown from the canonical guided-intake record. Authorization is not inferred from this view.</p>{selected.services.length?selected.services.map(service=><article key={service.id}><p className="eyebrow">{pretty(service.status)}</p><h4>{pretty(service.serviceType)}</h4><p>{service.startDate?`Started ${date(service.startDate)}`:"Start date not recorded"}{service.authorizedHours!==null?` · ${Number(service.authorizedHours)} recorded hour(s)`:""}</p></article>):<div className="empty-state">No services are associated with this client.</div>}{permissions.includes("client.intake.manage")?<button onClick={()=>selected.intakes[0]?.status==="COMPLETED"?editCompletedIntake("SERVICES"):setTab("Intake")}>Manage through guided intake</button>:null}</section>:null}
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
              {permissions.includes("client.document.generate")?<div className="action-group document-generation-actions">
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
              {permissions.includes("client.document.generate")?<details className="document-import-control"><summary>Import client PDF</summary><form className="inline-form" onSubmit={importDocument}><label>Document type<select name="documentType"><option value="FACE_SHEET">Face Sheet</option><option value="RIGHTS_ACKNOWLEDGMENT">Rights acknowledgment</option><option value="ROI">Release of information</option><option value="INTAKE_CHECKLIST">Intake checklist</option></select></label><label>PDF<input name="file" type="file" accept="application/pdf,.pdf" required/></label><label>Review outcome<select name="disposition"><option value="HISTORICAL_COMPLETE">Historical - already complete</option><option value="CURRENT_SIGNATURE_REQUIRED">Current signatures required</option></select></label><label>Historical completion date<input name="completedAt" type="date"/></label><button disabled={busy}>Import reviewed PDF</button><p>Complete historical uploads remain immutable and are not sent for signature. Incomplete current documents use the same native Sign Now or Send for Signature workflow.</p></form></details>:null}
              <div className="document-card-list">
              {selected.documents.filter(document=>document.status!=="VOIDED"&&!document.isHistoricalDuplicate).map((document) => (
                <article className="document-card" key={document.id} id={`document-${document.id}`}>
                  <p className="eyebrow">{document.source==="IMPORTED"?(document.status==="COMPLETED"?"Imported historical document":"Imported current document"):"Platform generated document"}</p>
                  <strong>{document.template.name}</strong>
                  {document.renewalOfDocumentId ? <span className="renewal-badge"> Renewal cycle</span> : null}
                  {document.source==="IMPORTED"?<span className="renewal-badge"> Imported</span>:null}
                  <p>
                    {pretty(document.status)} · {new Date(document.generatedAt).toLocaleString()}
                  </p>
                  {document.signatureIntegrityIssue?<p role="alert">This legacy signing cycle has incomplete evidence and is treated as unfinished. Open Signatures to recover it without accepting unsupported completion.</p>:null}
                  {document.envelope? <div className="signature-progress"><p><strong>{signatureProgress(document).completed} of {signatureProgress(document).total} required signatures completed</strong> · {signatureProgress(document).pending} pending</p>{signatureProgress(document).signers.map(signer=><p key={`document-signer:${signer.id}`}>{pretty(signer.role)} · {signer.name} · <strong>{signer.status==="SIGNED"?"Completed":pretty(invitationState(signer))}</strong>{signer.signedAt?` · ${date(signer.signedAt)}`:""}{signer.verificationMethod?` · ${pretty(signer.verificationMethod)}`:""}</p>)}</div>:null}
                  <div className="document-actions">
                  {permissions.includes("client.document.read")&&document.envelope?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${document.id}&artifact=${document.envelope.status==="COMPLETED"&&!document.signatureIntegrityIssue?"final":"current"}`}>{document.envelope.status==="COMPLETED"&&!document.signatureIntegrityIssue?"View signed document":signatureProgress(document).completed>0?"View current signed document":"Preview document"}</a>:null}
                  {permissions.includes("client.document.read")&&!document.envelope?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${document.id}&artifact=${document.status==="COMPLETED"?"final":"source"}`}>{document.status==="COMPLETED"?"View / download completed PDF":document.status==="DRAFT"?"Preview current draft PDF":"Preview signature-ready PDF"}</a>:null}
                  {permissions.includes("client.document.generate")&&document.status === "DRAFT"&&document.isCurrentActionable ? (
                    <button disabled={busy} onClick={() => documentAction({ action: "FINALIZE", documentId: document.id }, "Document is ready for a new signature workflow.")}>
                      Ready for Signature
                    </button>
                  ) : null}</div>
                  {document.source==="IMPORTED"&&document.status==="COMPLETED"?<p>Accepted as already complete historical evidence. Compliance Platform did not witness or create its prior signatures.</p>:null}
                  {permissions.includes("client.signature.manage")&&document.status === "READY_FOR_SIGNATURE" && !document.envelope&&document.isCurrentActionable ? <SignatureWorkflowPanel document={document} busy={busy} onStart={(requirementIndex,method,signers,confirmed)=>startSignature(document.id,requirementIndex,method,signers,confirmed)}/>:null}
                </article>
              ))}
              </div>
            </>
          ) : null}
          {tab === "Signatures" ? <section>
            <h3>Electronic signatures</h3>
            <p>Each signer reviews the frozen document, affirmatively consents, and adopts their own signature. A document completes only after every required signer signs.</p>
            {selected.documents.filter(item=>item.envelope).map(document=>{
              const progress=signatureProgress(document),envelope=document.envelope!;
              return <article key={document.id}>
                <p className="eyebrow">{document.template.name} · {pretty(envelope.mode)}</p>
                <h4>{pretty(envelope.status)}</h4>
                <p><strong>{progress.completed} of {progress.total} required signatures completed</strong> · {progress.pending} pending</p>
                {document.signatureIntegrityIssue?<><p role="alert">Stored completion evidence is incomplete. This cycle is fail-closed and can only be recovered from valid existing signer evidence or a missing signer’s ceremony.</p>{envelope.signers.every(signer=>signer.status==="SIGNED")?<button disabled={busy} onClick={()=>signatureAction({action:"RECONCILE",envelopeId:envelope.id},"Completion artifacts were safely re-derived from verified signer evidence.")}>Recover verified completion</button>:null}</>:null}
                <p>{envelope.status==="COMPLETED"&&envelope.completedAt?`Completed ${date(envelope.completedAt)}`:envelope.sentAt?`Sent ${date(envelope.sentAt)}`:"Prepared for signing"}</p>
                <p><a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${document.id}&artifact=${envelope.status==="COMPLETED"&&!document.signatureIntegrityIssue?"final":"current"}`}>{envelope.status==="COMPLETED"&&!document.signatureIntegrityIssue?"View signed document":progress.completed>0?"View current signed document":"Preview document"}</a>{envelope.status==="COMPLETED"&&!document.signatureIntegrityIssue?<> · <a href={`/api/organizations/${organizationId}/clients/${selected.id}/signatures?envelopeId=${envelope.id}`}>Download signature evidence</a></>:null}</p>
                {envelope.signers.map((signer,signerIndex)=>{const state=invitationState(signer),invitation=signer.invitations[0],requirement=document.signatureRequirements[signerIndex],invitationActive=invitation?.status==="ACTIVE",active=!["COMPLETED","VOIDED"].includes(envelope.status);return <div className="signature-row" key={signer.id}><span><strong>{signer.name}</strong><small>{pretty(signer.role)} · {signer.status==="SIGNED"?"completed":pretty(state)}</small><small>{signer.email??"In-person signer"}{signer.signedAt?` · Signed ${date(signer.signedAt)}`:invitation?` · Invited ${date(invitation.createdAt)} · Expires ${date(invitation.expiresAt)}`:""}{signer.verificationMethod?` · ${pretty(signer.verificationMethod)}`:""}</small></span><div className="action-group">{active&&signer.status!=="SIGNED"&&requirement?.allowedMethods.includes("SIGN_NOW")?<button disabled={busy} onClick={()=>signatureAction({action:"SIGN_NOW_SESSION",envelopeId:envelope.id,signerId:signer.id},`Sign now opened for ${signer.name}.`,true)}>Sign now</button>:null}{active&&signer.status!=="SIGNED"&&requirement?.allowedMethods.includes("SEND_FOR_SIGNATURE")&&signer.email?<button disabled={busy} onClick={()=>signatureAction({action:invitationActive?"REISSUE":"SEND_INVITATION",envelopeId:envelope.id,signerId:signer.id,requirementIndex:signerIndex},`${invitation?"Reissued":"New"} invitation created for ${signer.name}.`)}>{invitation?"Reissue":"Send for signature"}</button>:null}{active&&signer.status!=="SIGNED"&&invitationActive?<button className="secondary" disabled={busy} onClick={()=>signatureAction({action:"REVOKE",envelopeId:envelope.id,signerId:signer.id},`Invitation revoked for ${signer.name}; the signing cycle remains active.`)}>Revoke</button>:null}</div></div>})}
                {!["COMPLETED","VOIDED"].includes(envelope.status)?<form className="inline-form" onSubmit={event=>{event.preventDefault();const reason=new FormData(event.currentTarget).get("reason");void signatureAction({action:"CANCEL",envelopeId:envelope.id,reason},"Signing cycle voided and all active invitations revoked; signatures were not transferred.")}}><label>Cancellation reason<input name="reason" required/></label><button disabled={busy}>Cancel and revoke invitations</button></form>:envelope.voidReason?<p>Cancellation reason: {envelope.voidReason}</p>:null}
              </article>;
            })}
          </section> : null}
          {tab === "Contacts" ? <section><h3>Contacts and representatives</h3><p>Only people associated with this client in the current tenant are shown.</p>{selected.contacts.map(item=><article key={`${item.professionalContact.id}:${item.role}`}><p className="eyebrow">{pretty(item.role)} · reusable professional contact</p><h4>{item.professionalContact.name}</h4><p>{item.professionalContact.agency??"No agency"} · {item.professionalContact.email??"No email"} · {item.professionalContact.phone??"No phone"}</p></article>)}{selected.representatives.map(item=><article key={item.id}><p className="eyebrow">{pretty(item.representativeType)}</p><h4>{item.name}</h4><p>{item.relationship??"Relationship not recorded"} · {item.email??"No email"}</p></article>)}{selected.emergencyContacts.map(item=><article key={item.id}><p className="eyebrow">Emergency contact</p><h4>{item.name}</h4><p>{item.relationship} · {item.phone}{item.informationSharingAllowed?" · information sharing authorized":" · no information-sharing authorization recorded"}</p></article>)}{!selected.contacts.length&&!selected.representatives.length&&!selected.emergencyContacts.length?<div className="empty-state">No contacts or representatives are recorded.</div>:null}{permissions.includes("client.intake.manage")?<button onClick={()=>selected.intakes[0]?.status==="COMPLETED"?editCompletedIntake("REPRESENTATIVE"):setTab("Intake")}>Manage through guided intake</button>:null}</section>:null}
          {tab === "History" ? <section><h3>Client history and provenance</h3><p>Historical completed documents, signatures, imports, renewals, and lifecycle records remain immutable.</p>{selected.documents.filter(item=>item.isHistoricalDuplicate).map(item=><article key={`duplicate:${item.id}`}><p className="eyebrow">Superseded draft · preserved history</p><h4>{item.template.name}</h4><p>Created {date(item.generatedAt)}. A newer equivalent document is the only actionable cycle.</p>{permissions.includes("client.document.read")?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${item.id}`}>View preserved draft</a>:null}</article>)}{selected.importSessions.map(item=><article key={item.id}><p className="eyebrow">Import · {pretty(item.status)}</p><h4>{item._count.documents} preserved document(s)</h4><p>{item.confirmedAt?`Confirmed ${date(item.confirmedAt)}`:`Updated ${date(item.updatedAt)}`} · {item._count.proposals} reviewed proposal(s)</p></article>)}{selected.history.length?selected.history.map(item=><article key={item.id}><p className="eyebrow">{date(item.occurredAt)} · {pretty(item.entityType)}</p><h4>{pretty(item.eventType.replace(/^client\./,""))}</h4><p>{item.actor?.email?`Recorded by ${item.actor.email}`:"Recorded by the platform workflow"}</p></article>):<div className="empty-state">No material client events have been recorded.</div>}</section> : null}
        </section>
      ) : null}
    </main>
  );
}
