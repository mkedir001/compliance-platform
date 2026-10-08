"use client";
/* eslint-disable react-hooks/exhaustive-deps -- production organization context is fixed by the authenticated landing route */
import { FormEvent, useEffect, useRef, useState } from "react";
import GuidedIntake from "./guided-intake";
import ClientImportWorkflow from "./client-import-workflow";
import AddClientDrawer from "./add-client-drawer";
import { DocumentPdfViewer } from "./document-pdf-viewer";
import { ActionPopover } from "./action-popover";
import { clientDirectoryView, type ClientDirectoryLoadStatus } from "./directory-state";
import type { IntakeStepId } from "@/domain/clients/intake-state";
import { PortalShell, StatusChip } from "@/app/components/portal-ui";

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
type ImportSummary={id:string;status:string;target:string;existingClientId:string|null;createdAt:string;updatedAt:string;_count:{documents:number;proposals:number}};
type ClientDocument = {
  id: string;
  documentType: string;
  status: string;
  source: "GENERATED"|"IMPORTED";
  originalFileName: string|null;
  importedAt: string|null;
  snapshotJson?:{disposition?:string;form?:Record<string,unknown>;roi?:Record<string,unknown>};
  generatedAt: string;
  invitationLifetimeHours:number;
  renewalOfDocumentId: string | null;
  isCurrentActionable:boolean;
  isHistoricalDuplicate:boolean;
  signatureIntegrityIssue:boolean;
  template:{name:string;versionNumber:number};
  signatureRequirements:{key:string;label:string;allowedRoles:string[];allowedMethods:("SIGN_NOW"|"SEND_FOR_SIGNATURE")[];candidates:{role:string;name:string;email:string|null;source:string}[]}[];
  envelope: { id:string;status:string;mode:string;sentAt:string|null;completedAt:string|null;voidReason:string|null;signers:{id:string;role:string;name:string;email:string|null;identityPending:boolean;status:string;sentAt:string|null;viewedAt:string|null;signedAt:string|null;signatureMethod:string|null;verificationMethod:string|null;invitations:{id:string;status:string;deliveryStatus:"PENDING"|"ACCEPTED"|"FAILED";deliveryAttempts:number;deliveryAttemptedAt:string|null;createdAt:string;providerAcceptedAt:string|null;deliveredAt:string|null;expiresAt:string;usedAt:string|null;revokedAt:string|null}[]}[] } | null;
};
type ClientRepresentative = { id: string; representativeType: string; name: string; relationship: string | null; email: string | null };
type ClientDocumentRequest = { id: string; documentType: string; recipientType: string; recipientName: string; deliveryChannel: string; status: string; requestedAt: string | null; dueAt: string | null; latestFollowUpAt: string | null; followUpCount: number; obligationDocumentId: string | null; fulfilledDocumentId: string | null };
type ClientDetail = ClientRow & {
  dateOfBirth: string | null;
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
function documentLifecycle(document:ClientDocument,cycle?:RenewalCycle|null){if(cycle?.status==="OVERDUE")return"EXPIRED";if(cycle?.status==="DUE_SOON")return"EXPIRING";if(document.source==="IMPORTED"&&document.snapshotJson?.disposition==="PRESERVE_ONLY")return"NO_SIGNATURE_REQUIRED";if(!document.signatureRequirements.length)return"NO_SIGNATURE_REQUIRED";if(document.status==="COMPLETED"&&!document.signatureIntegrityIssue)return"SIGNED_CURRENT";const progress=signatureProgress(document);if(progress.completed>0)return"PARTIALLY_SIGNED";if(document.envelope)return"AWAITING_SIGNATURES";return"SIGNATURE_REQUIRED"}
function SignatureWorkflowPanel({document,busy,onStart}:{document:ClientDocument;busy:boolean;onStart:(requirementIndex:number,method:"SIGN_NOW"|"SEND_FOR_SIGNATURE",signers:PreparedSigner[],confirmed:boolean)=>Promise<void>}){const requirements=document.signatureRequirements,[selected,setSelected]=useState(()=>requirements.map(()=>0)),[names,setNames]=useState(()=>requirements.map(requirement=>requirement.candidates[0]?.name??"")),[emails,setEmails]=useState(()=>requirements.map(requirement=>requirement.candidates[0]?.email??"")),[remoteIndex,setRemoteIndex]=useState<number|null>(null);function signer(index:number){const requirement=requirements[index],candidate=requirement.candidates[selected[index]];return{role:candidate?.role??requirement.allowedRoles[0],name:(names[index]?.trim()||candidate?.name)??"",email:emails[index]?.trim()||undefined}}function roster(){return requirements.map((_,index)=>signer(index))}function updateCandidate(index:number,value:number){const candidate=requirements[index].candidates[value],next=[...selected],nextNames=[...names],nextEmails=[...emails];next[index]=value;nextNames[index]=candidate?.name??"";nextEmails[index]=candidate?.email??"";setSelected(next);setNames(nextNames);setEmails(nextEmails);setRemoteIndex(null)}const rosterReady=requirements.every((_,index)=>signer(index).name);return <div className="signature-workflow"><h5>Required signatures</h5><div className="signer-roster">{requirements.map((requirement,index)=>{const candidate=requirement.candidates[selected[index]],row=signer(index);return <section className="signer-requirement" key={requirement.key}><div><h6>{requirement.label}</h6>{requirement.candidates.length>1?<label>Intended signer<select value={selected[index]} onChange={event=>updateCandidate(index,Number(event.target.value))}>{requirement.candidates.map((option,optionIndex)=><option key={`${option.role}:${option.name}`} value={optionIndex}>{option.name} — {pretty(option.role)}</option>)}</select></label>:<p>{row.name?<strong>{row.name}</strong>:"Identity will be confirmed in the signing ceremony"}<br/><small>Pending</small></p>}</div><div className="signature-actions">{requirement.allowedMethods.includes("SIGN_NOW")?<button type="button" disabled={busy} onClick={()=>void onStart(index,"SIGN_NOW",roster(),false)}>Sign now</button>:null}{requirement.allowedMethods.includes("SEND_FOR_SIGNATURE")?<button type="button" className="secondary" disabled={busy||!candidate} onClick={()=>setRemoteIndex(index)}>Send for signature</button>:null}</div></section>})}</div>{remoteIndex!==null?<section className="send-review" aria-label="Send for signature review"><h5>{`Send for signature — ${requirements[remoteIndex].label}`}</h5>{requirements.map((requirement,index)=>!signer(index).name?<label key={requirement.key}>Confirm {requirement.label} name<input value={names[index]} onChange={event=>{const next=[...names];next[index]=event.target.value;setNames(next)}} required/></label>:null)}<label>Recipient name<input value={names[remoteIndex]} onChange={event=>{const next=[...names];next[remoteIndex]=event.target.value;setNames(next)}} required/></label><label>Delivery email<input type="email" value={emails[remoteIndex]} onChange={event=>{const next=[...emails];next[remoteIndex]=event.target.value;setEmails(next)}} required/></label><p>Invitation expires after {document.invitationLifetimeHours} hours. The recipient will review the current authoritative rendition.</p><div className="signature-actions"><button type="button" disabled={busy||!rosterReady||!emails[remoteIndex]} onClick={()=>onStart(remoteIndex,"SEND_FOR_SIGNATURE",roster(),true)}>Send invitation</button><button type="button" className="secondary" onClick={()=>setRemoteIndex(null)}>Cancel</button></div></section>:null}</div>}

function ManagedSignerActions({document,signerIndex,busy,onAction,onStart}:{document:ClientDocument;signerIndex:number;busy:boolean;onAction:(body:unknown,text:string,openUrl?:boolean)=>Promise<void>;onStart:(requirementIndex:number,method:"SIGN_NOW"|"SEND_FOR_SIGNATURE",signers:PreparedSigner[],confirmed:boolean)=>Promise<void>}){
  const envelope=document.envelope!,signer=envelope.signers[signerIndex],requirement=document.signatureRequirements[signerIndex],invitation=signer.invitations[0],invitationActive=invitation?.status==="ACTIVE",active=!["COMPLETED","VOIDED"].includes(envelope.status),canSignNow=active&&signer.status!=="SIGNED"&&requirement?.allowedMethods.includes("SIGN_NOW"),canSend=active&&signer.status!=="SIGNED"&&requirement?.allowedMethods.includes("SEND_FOR_SIGNATURE");
  const[collectingRecipient,setCollectingRecipient]=useState(false),[recipientName,setRecipientName]=useState(signer.identityPending?"":signer.name),[recipientEmail,setRecipientEmail]=useState(signer.email??"");
  if(!canSignNow&&!canSend&&!invitationActive)return null;
  async function submitRecipient(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const roster=envelope.signers.map((row,index)=>({role:row.role,name:index===signerIndex?recipientName.trim():row.name,email:index===signerIndex?recipientEmail.trim()||undefined:row.email??undefined}));await onStart(signerIndex,"SEND_FOR_SIGNATURE",roster,true);setCollectingRecipient(false)}
  return <div className="managed-signer-actions">
    <div className="action-group">
      {canSignNow?<button disabled={busy} onClick={()=>onAction({action:"SIGN_NOW_SESSION",envelopeId:envelope.id,signerId:signer.id},`Sign now opened for ${signer.name}.`,true)}>Sign now</button>:null}
      {canSend&&invitation?<button disabled={busy} onClick={()=>onAction({action:invitationActive?"REISSUE":"SEND_INVITATION",envelopeId:envelope.id,signerId:signer.id,requirementIndex:signerIndex},`Reissued invitation created for ${signer.name}.`)}>Reissue</button>:null}
      {canSend&&!invitation?<button disabled={busy} aria-expanded={collectingRecipient} onClick={()=>signer.email?onAction({action:"SEND_INVITATION",envelopeId:envelope.id,signerId:signer.id,requirementIndex:signerIndex},`New invitation created for ${signer.name}.`):setCollectingRecipient(true)}>Send for signature</button>:null}
      {active&&signer.status!=="SIGNED"&&invitationActive?<button className="secondary" disabled={busy} onClick={()=>onAction({action:"REVOKE",envelopeId:envelope.id,signerId:signer.id},`Invitation revoked for ${signer.name}; the signing cycle remains active.`)}>Revoke</button>:null}
    </div>
    {collectingRecipient&&canSend&&!invitation?<form className="recipient-collection" onSubmit={submitRecipient} aria-label={`Recipient details for ${requirement.label}`}><p>Confirm the intended recipient before secure delivery.</p><label>Recipient name<input value={recipientName} onChange={event=>setRecipientName(event.target.value)} required/></label><label>Delivery email<input type="email" value={recipientEmail} onChange={event=>setRecipientEmail(event.target.value)} required/></label><div className="action-group"><button disabled={busy||!recipientName.trim()||!recipientEmail.trim()}>Send invitation</button><button type="button" className="secondary" disabled={busy} onClick={()=>setCollectingRecipient(false)}>Cancel</button></div></form>:null}
  </div>;
}

export default function ClientsPortal({ initialOrganizationId = "", initialClientId = "", initialDocumentId = "", initialRequestId = "", initialImportSessionId = "", initialView = "", productionIdentity = false }: { initialOrganizationId?: string; initialClientId?: string; initialDocumentId?: string; initialRequestId?: string; initialImportSessionId?:string; initialView?:string; productionIdentity?: boolean }) {
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
    [pendingImports,setPendingImports]=useState<ImportSummary[]>([]),
    [addClientOpen,setAddClientOpen]=useState(false),
    [directoryStatus,setDirectoryStatus]=useState<ClientDirectoryLoadStatus>("idle"),
    [tab, setTab] = useState("Overview"),
    [editingCompletedIntake,setEditingCompletedIntake]=useState(false),
    [editStartStep,setEditStartStep]=useState<IntakeStepId>("CLIENT"),
    [selectedDocumentId,setSelectedDocumentId]=useState(initialDocumentId),
    [documentSearch,setDocumentSearch]=useState(""),
    [documentStatus,setDocumentStatus]=useState("ALL"),
    [clientImportOpen,setClientImportOpen]=useState(false),
    [editingDocumentId,setEditingDocumentId]=useState(""),
    [documentEditorOpen,setDocumentEditorOpen]=useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headers: Record<string, string> = productionIdentity ? { "content-type": "application/json" } : { "content-type": "application/json", "x-dev-user-id": userId };
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`/api/organizations/${organizationId}/clients${path}`, { ...init, headers: { ...headers, ...init?.headers } }),
      body = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.blob();
    if (!response.ok) throw new Error((body as { error?: string }).error ?? "Client operation failed");
    return body;
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client operation failed");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function load() {
    setDirectoryStatus("loading");
    await run(async () => {try{const[rows,accessResponse,importsResponse]=await Promise.all([request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`),fetch(`/api/organizations/${organizationId}`,{headers}),fetch(`/api/organizations/${organizationId}/clients/imports`,{headers})]),access=await accessResponse.json(),imports=await importsResponse.json();if(!accessResponse.ok)throw new Error(access.error??"Organization access failed");setClients(rows as ClientRow[]);setPermissions(access.permissions??[]);if(importsResponse.ok)setPendingImports((imports as ImportSummary[]).filter(item=>item.status==="REVIEW_REQUIRED"));setDirectoryStatus("success")}catch(error){setDirectoryStatus("error");throw error}});
  }
  async function open(id: string) {
    await run(async () => {
      setSelected((await request(`/${id}`)) as ClientDetail);
      if (typeof window !== "undefined" && !window.location.pathname.endsWith(`/${id}`)) window.history.pushState({}, "", `/admin/clients/${id}?organizationId=${encodeURIComponent(organizationId)}`);
    });
  }
  async function refresh(text: string) {
    if (!selected) return;
    setSelected((await request(`/${selected.id}`)) as ClientDetail);
    setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`)) as ClientRow[]);
    setMessage(text);
  }
  async function documentAction(body: unknown, text: string) {
    if (!selected) return false;
    return run(async () => {
      const result=await request(`/${selected.id}/documents`, {
        method: "POST",
        body: JSON.stringify(body),
      }) as {id?:string};
      if(result.id)setSelectedDocumentId(result.id);
      await refresh(text);
    });
  }
  async function guidedSave(next:ClientDetail,text:string){setSelected(next);setClients((await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&renewalStatus=${encodeURIComponent(renewalStatus)}&readiness=${encodeURIComponent(readiness)}&operational=${encodeURIComponent(operational)}`)) as ClientRow[]);setMessage(text)}
  async function changeLifecycle(nextStatus:"ACTIVE"|"DISCHARGED"|"ARCHIVED"){if(!selected)return;const reason=window.prompt(`Reason for changing this client to ${pretty(nextStatus)}`)?.trim();if(!reason)return;await run(async()=>{const next=await request(`/${selected.id}`,{method:"PATCH",body:JSON.stringify({status:nextStatus,reason})}) as ClientDetail;setSelected(next);await refresh(`Client lifecycle changed to ${pretty(nextStatus)}. Historical records were preserved.`)})}
  async function guidedGenerate(body:unknown,text:string){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/documents`,{method:"POST",headers,body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error??"Document generation failed");await open(selected.id);setMessage(text)}
  async function guidedComplete(acknowledgeRecommendations=false){if(!selected)return;const response=await fetch(`/api/organizations/${organizationId}/clients/${selected.id}/intake`,{method:"POST",headers,body:JSON.stringify({action:"COMPLETE",acknowledgeRecommendations})}),result=await response.json();if(!response.ok){const error=new Error(result.error??"Intake completion failed") as Error&{details?:unknown};error.details=result.details;throw error}await open(selected.id);setTab("Documents");const prepared=result.documentPreparation?.prepared?.length?` Prepared: ${result.documentPreparation.prepared.join(", ")}.`:"",issues=result.documentPreparation?.notPrepared?.length?` Needs attention: ${result.documentPreparation.notPrepared.join("; ")}.`:"",deferred=result.deferredRecommendations?.length?" Recommended information was intentionally deferred for follow-up.":"";setMessage(result.alreadyCompleted?"Intake was already complete. Continue with the current document workflow.":`Intake review completed.${deferred}${prepared}${issues}`)}
  async function requestAction(body: unknown, text: string) {
    if (!selected) return false;
    return run(async () => {
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
    const created=await requestAction({ action: "CREATE", request: { documentType: data.get("documentType"), recipientType: representative ? "REPRESENTATIVE" : "CLIENT", representativeId: representative, deliveryChannel: data.get("deliveryChannel"), dueAt: obligationDocumentId ? undefined : data.get("dueAt") || undefined, obligationDocumentId } }, "Document request draft created. Review it before sending.");
    if(created)form.reset();return created;
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
  async function importDocument(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selected)return;const form=event.currentTarget,data=new FormData(form),file=data.get("file");if(!(file instanceof File)||!file.size){setMessage("Select a PDF to import.");return}await run(async()=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));const imported=await request(`/${selected.id}/documents`,{method:"POST",body:JSON.stringify({action:"IMPORT",document:{documentType:data.get("documentType"),fileName:file.name,pdfBase64:btoa(binary),disposition:data.get("disposition"),completedAt:data.get("completedAt")||undefined}})}) as {id?:string};if(imported.id)setSelectedDocumentId(imported.id);form.reset();await refresh(data.get("disposition")==="HISTORICAL_COMPLETE"?"Completed historical PDF preserved without a new signing request.":"Imported PDF preserved and prepared for the native signing workflow.")})}
  async function signatureAction(body:unknown,text:string,openUrl=false){if(!selected)return;await run(async()=>{const result=await request(`/${selected.id}/signatures`,{method:"POST",body:JSON.stringify(body)}) as {url?:string};if(openUrl&&result.url){window.location.assign(result.url);return}await refresh(text)})}
  function editCompletedIntake(step:IntakeStepId){setEditStartStep(step);setEditingCompletedIntake(true);setTab("Intake")}
  function beginDocumentEdit(document:ClientDocument){setEditingDocumentId(document.id);setDocumentEditorOpen(false);if(document.documentType==="FACE_SHEET")editCompletedIntake("CLIENT");else if(document.documentType==="RIGHTS_ACKNOWLEDGMENT"||document.documentType==="ROI")setDocumentEditorOpen(true)}
  async function finishDocumentEdit(){if(!editingDocumentId){setEditingCompletedIntake(false);setTab(editStartStep==="SERVICES"?"Services":"Overview");setMessage("Client information updated.");return}const revised=await documentAction({action:"REVISE_DRAFT",documentId:editingDocumentId},"Client information saved and a new draft version generated. The previous draft remains in history.");if(revised){setEditingDocumentId("");setEditingCompletedIntake(false);setTab("Documents")}}
  async function reviseDocumentSpecific(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selectedDocument)return;const data=new FormData(event.currentTarget);let body:Record<string,unknown>={action:"REVISE_DRAFT",documentId:selectedDocument.id};if(selectedDocument.documentType==="RIGHTS_ACKNOWLEDGMENT")body={...body,formData:{writtenCopyReceivedDate:data.get("writtenCopyReceivedDate"),rightsExplainedDate:data.get("rightsExplainedDate"),explanationMethod:data.get("explanationMethod"),explanationNotes:data.get("explanationNotes")||undefined,annualReviewDate:data.get("annualReviewDate")||undefined,grievanceContact:data.get("grievanceContact")||undefined,grievancePhoneEmail:data.get("grievancePhoneEmail")||undefined}};else body={...body,roi:{direction:data.get("direction"),recipientName:data.get("recipientName"),categories:data.getAll("categories"),purposes:data.getAll("purposes"),effectiveDate:data.get("effectiveDate"),expirationDate:data.get("expirationDate"),expirationEvent:data.get("expirationEvent")||undefined}};const revised=await documentAction(body,"A corrected draft version was generated. The previous draft remains in history.");if(revised){setDocumentEditorOpen(false);setEditingDocumentId("")}}
  async function deleteDraft(document:ClientDocument){if(!window.confirm(`Delete the unsigned draft “${document.template.name}”? The platform will preserve an audit record.`))return;const deleted=await documentAction({action:"DELETE_DRAFT",documentId:document.id},"Draft removed from the active workspace. Its audit history was preserved.");if(deleted)setSelectedDocumentId("")}
  useEffect(() => {
    if (productionIdentity && organizationId) {
      void (async()=>{await load();if(initialClientId){setTab(initialDocumentId || initialRequestId || initialView==="Documents" ? "Documents" : initialView==="Signatures" ? "Signatures" : initialView==="Readiness" ? "Readiness" : initialView==="Intake" ? "Intake" : "Overview");await open(initialClientId)}})();
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
    if (selected && initialDocumentId && tab === "Documents") setSelectedDocumentId(initialDocumentId);
  }, [selected, initialDocumentId, tab]);
  useEffect(() => {
    if (selected && initialRequestId && tab === "Documents") document.getElementById(`request-${initialRequestId}`)?.scrollIntoView({ block: "center" });
  }, [selected, initialRequestId, tab]);
  const tabs = ["Overview", "Intake", "Services", "Documents", "Signatures", "Readiness", "Contacts", "History"];
  const directoryView = clientDirectoryView(directoryStatus, clients.length);
  const availableDocuments=selected?.documents.filter(item=>item.status!=="VOIDED"&&!item.isHistoricalDuplicate)??[];
  const filteredDocuments=availableDocuments.filter(item=>(documentStatus==="ALL"||item.status===documentStatus)&&(!documentSearch.trim()||`${item.template.name} ${item.documentType} ${item.originalFileName??""}`.toLowerCase().includes(documentSearch.trim().toLowerCase())));
  const selectedDocument=availableDocuments.find(item=>item.id===selectedDocumentId)??availableDocuments[0]??null;
  const selectedDraftEditable=Boolean(selectedDocument&&selectedDocument.source==="GENERATED"&&selectedDocument.status==="DRAFT"&&selectedDocument.isCurrentActionable&&!selectedDocument.envelope&&!selectedDocument.renewalOfDocumentId);
  const selectedSupportsEditor=Boolean(selectedDraftEditable&&selectedDocument&&(["RIGHTS_ACKNOWLEDGMENT","ROI"].includes(selectedDocument.documentType)||selectedDocument.documentType==="FACE_SHEET"&&selected?.intakes[0]?.status==="COMPLETED"));
  const selectedRenewal=selectedDocument?selected?.renewalSummary.cycles.find(item=>item.documentId===selectedDocument.id)??null:null;
  const selectedArtifact=selectedDocument?(selectedDocument.envelope?(selectedDocument.envelope.status==="COMPLETED"&&!selectedDocument.signatureIntegrityIssue?"final":"current"):(selectedDocument.status==="COMPLETED"?"final":"source")):"source";
  const selectedDocumentUrl=selected&&selectedDocument?`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${selectedDocument.id}&artifact=${selectedArtifact}`:"";
  return (
    <PortalShell organizationId={organizationId} current="Clients"><main className="admin-shell" aria-busy={busy}>
      <header className="client-page-heading">
        <div><p className="eyebrow">Client management</p><h1>{selected?`${selected.legalFirstName} ${selected.legalLastName}`:initialImportSessionId?"Review imported documents":"Clients"}</h1><p className="lede">{selected?"Client intake, documents, signatures, and renewals.":initialImportSessionId?"Review extracted information before any client record changes.":"Intake, documents, signatures, and renewals for each person you serve."}</p></div>
        {selected||initialImportSessionId?<button className="secondary" onClick={()=>window.location.assign(`/admin/clients?organizationId=${encodeURIComponent(organizationId)}`)}>Back to Clients</button>:permissions.includes("client.create")?<button onClick={()=>setAddClientOpen(true)}>Add client</button>:null}
      </header>
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
      <p className="portal-message" role="status" aria-live="polite">
        {busy ? "Updating authoritative client records…" : message}
      </p>
      {!selected&&initialImportSessionId?<ClientImportWorkflow organizationId={organizationId} headers={headers} busy={busy} onBusy={setBusy} initialSessionId={initialImportSessionId} standalone onComplete={async clientId=>window.location.assign(`/admin/clients/${clientId}?organizationId=${encodeURIComponent(organizationId)}&view=Intake`)}/>:null}
      {!selected&&!initialImportSessionId ? <section>
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
        {pendingImports.length?<aside className="pending-imports" aria-label="Pending client document imports"><div><p className="eyebrow">Document review pending</p><h3>{pendingImports.length} unfinished import{pendingImports.length===1?"":"s"}</h3><p>Original files are preserved. Resume review before creating or linking a client.</p></div><select aria-label="Choose pending import" defaultValue={pendingImports[0].id} id="pending-import-selection">{pendingImports.map(item=><option key={item.id} value={item.id}>{item._count.documents} document{item._count.documents===1?"":"s"} · updated {new Date(item.updatedAt).toLocaleDateString()}</option>)}</select><button type="button" onClick={()=>{const id=(document.getElementById("pending-import-selection") as HTMLSelectElement).value;window.location.assign(`/admin/clients?organizationId=${encodeURIComponent(organizationId)}&importSessionId=${encodeURIComponent(id)}`)}}>Resume review</button></aside>:null}
        {directoryView === "results" ? (
          <div className="workforce-table client-directory" role="table" aria-label="Client directory">
            <div className="client-directory-head" role="row"><span>Client</span><span>Status</span><span>Services</span><span>Documentation</span><span>Signatures</span></div>
            {clients.map((client) => (
              <button key={client.id} className={`workforce-row client-directory-row renewal-${client.documentationReadiness.overallState.toLowerCase()}`} onClick={() => open(client.id)}>
                <span>
                  <strong>
                    {client.legalLastName}, {client.preferredName ?? client.legalFirstName}
                  </strong>
                </span>
                <span><StatusChip tone={client.status==="ACTIVE"?"good":client.status==="DISCHARGED"||client.status==="ARCHIVED"?"neutral":"warning"}>{pretty(client.status)}</StatusChip></span>
                <span><strong>{client.services.length?client.services.map(item=>pretty(item.serviceType)).join(", "):"No current services"}</strong><small>{client.services.map(item=>pretty(item.status)).join(", ")}</small></span>
                <span>
                  <strong>{pretty(client.documentationReadiness.overallState)}</strong>
                  <small>{client.documentationReadiness.counts.overdue} overdue · {client.documentationReadiness.counts.missing} missing · {client.documentationReadiness.counts.outstandingRequests} collection underway</small>
                </span>
                <span><strong>{client._count.documents?`${client._count.documents} awaiting signature`:"No signatures pending"}</strong><small>{client._count.documentRequests} outstanding request(s)</small></span>
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
      </section> : null}
      {selected ? (
        <section className="client-record">
          <div className="record-header">
            <div className="record-identity"><span className="record-avatar" aria-hidden="true">{selected.legalFirstName[0]}{selected.legalLastName[0]}</span><div>
              <p className="eyebrow">Client record</p>
              <h2>
                {selected.legalFirstName} {selected.legalLastName}
              </h2>
              <p><StatusChip tone={selected.status==="ACTIVE"?"good":selected.status==="DISCHARGED"||selected.status==="ARCHIVED"?"neutral":"warning"}>{pretty(selected.status)}</StatusChip> <StatusChip tone={selected.documentationReadiness.overallState==="CURRENT"?"good":selected.documentationReadiness.overallState==="OVERDUE"?"danger":"warning"}>Documentation {pretty(selected.documentationReadiness.overallState)}</StatusChip></p>
            </div></div><div className="record-actions">{permissions.includes("client.update")?<button className="secondary" aria-expanded={clientImportOpen} onClick={()=>setClientImportOpen(value=>!value)}>Import documents</button>:null}</div>
          </div>
          {clientImportOpen&&permissions.includes("client.update")?<section className="persistent-client-import" aria-label="Import documents for this client"><div className="section-heading"><div><h3>Import documents</h3><p>Upload original PDFs for human review without changing canonical client information.</p></div><button type="button" className="secondary" onClick={()=>setClientImportOpen(false)}>Close</button></div><ClientImportWorkflow organizationId={organizationId} headers={headers} busy={busy} onBusy={setBusy} existingClientId={selected.id} standalone onComplete={async()=>{setClientImportOpen(false);await open(selected.id);await load();setTab("Documents")}}/></section>:null}
          <nav className="admin-nav record-tabs" aria-label="Client record">
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
            </section>
          ) : null}
          {tab === "Readiness" ? <section className="renewal-panel"><h3>Documentation readiness</h3><p><strong>{pretty(selected.documentationReadiness.overallState)}</strong> · {selected.documentationReadiness.counts.satisfied} of {selected.documentationReadiness.counts.applicable} applicable requirement(s) currently satisfied</p><p>{selected.documentationReadiness.counts.missing} missing · {selected.documentationReadiness.counts.dueSoon} due soon · {selected.documentationReadiness.counts.overdue} overdue · {selected.documentationReadiness.counts.outstandingRequests} with collection underway</p><p>{selected.documentationReadiness.meaning}</p>{selected.documentationReadiness.requirements.map(item=><article key={item.id}><p className="eyebrow">{pretty(item.state)}{item.deadlinePhase?` · ${pretty(item.deadlinePhase)}`:""}</p><h4>{item.name}</h4><p>{item.reason}</p><p>{item.dueDate?`Due ${date(item.dueDate)}`:"No determinable deadline"}{item.signatureStatus?` · signature ${pretty(item.signatureStatus)}`:""}</p>{item.outstandingRequests.map(request=><p key={request.id}>Collection request {pretty(request.status)} for {request.recipientName}. <a href={request.actionHref}>Open request</a></p>)}<a href={item.actionHref}>Open document workflow</a></article>)}</section> : null}
          {tab === "Intake" ? permissions.includes("client.intake.manage")?(selected.intakes[0]?.status==="COMPLETED"?(editingCompletedIntake?<GuidedIntake client={selected} organizationId={organizationId} headers={headers} canGenerate={permissions.includes("client.document.generate")} canReadDocuments={permissions.includes("client.document.read")} canSign={permissions.includes("client.signature.manage")} updateMode initialStep={editStartStep} revisingDocumentId={editingDocumentId||undefined} onSaved={(next,text)=>guidedSave(next as ClientDetail,text)} onGenerate={guidedGenerate} onComplete={guidedComplete} onFinishUpdate={()=>void finishDocumentEdit()}/>:<article><h3>Guided intake completed</h3><p>The initial intake completion is preserved. Authorized staff may update current client information without changing completed intake evidence or immutable document snapshots.</p><div className="action-group"><button onClick={()=>editCompletedIntake("CLIENT")}>Update client information</button><button className="secondary" onClick={()=>setTab("Documents")}>Open Documents</button></div></article>):<GuidedIntake client={selected} organizationId={organizationId} headers={headers} canGenerate={permissions.includes("client.document.generate")} canReadDocuments={permissions.includes("client.document.read")} canSign={permissions.includes("client.signature.manage")} onSaved={(next,text)=>guidedSave(next as ClientDetail,text)} onGenerate={guidedGenerate} onComplete={guidedComplete}/>):<article><h3>Guided intake</h3><p>Your current permissions allow client review but not intake changes.</p></article> : null}
          {tab === "Services" ? <section><h3>Services</h3><p>Service information is shown from the canonical guided-intake record. Authorization is not inferred from this view.</p>{selected.services.length?selected.services.map(service=><article key={service.id}><p className="eyebrow">{pretty(service.status)}</p><h4>{pretty(service.serviceType)}</h4><p>{service.startDate?`Started ${date(service.startDate)}`:"Start date not recorded"}{service.authorizedHours!==null?` · ${Number(service.authorizedHours)} recorded hour(s)`:""}</p></article>):<div className="empty-state">No services are associated with this client.</div>}{permissions.includes("client.intake.manage")?<button onClick={()=>selected.intakes[0]?.status==="COMPLETED"?editCompletedIntake("SERVICES"):setTab("Intake")}>Manage through guided intake</button>:null}</section>:null}
          {tab === "LegacyDocuments" ? (
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
                  {permissions.includes("client.document.generate")&&document.source==="GENERATED"&&document.status === "DRAFT"&&document.isCurrentActionable ? (
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
          {tab === "Documents" ? <section className="documents-workspace" aria-label="Client documents workspace">
            <div className="documents-toolbar">
              <div><p className="eyebrow">Authoritative records</p><h3>Documents</h3><p>Review the latest available rendition, signing progress, and document lifecycle.</p></div>
              {permissions.includes("client.document.generate")?<div className="documents-toolbar-actions">
                <ActionPopover label="Generate document">{close=><div className="document-menu generation-menu" aria-label="Supported generated documents">{[["FACE_SHEET","▤","Face Sheet","Current client, service, contact, and health data"],["RIGHTS_ACKNOWLEDGMENT","✓","Rights Acknowledgment","Rights review answers and current signer requirements"],["INTAKE_CHECKLIST","☷","Intake Checklist","Current guided-intake checklist state"]].map(([documentType,icon,name,description])=><button type="button" key={documentType} disabled={busy} onClick={async()=>{if(await documentAction({action:"GENERATE",documentType},`${name} generated and selected.`))close()}}><span className="document-option-icon" aria-hidden="true">{icon}</span><span><strong>{name}</strong><small>{description}</small><small className="document-option-version">Active template · current version</small></span></button>)}</div>}</ActionPopover>
                <ActionPopover label="Request document" initialOpen={Boolean(initialRequestId)}>{close=><form className="document-menu request-menu" onSubmit={async event=>{if(await createRequest(event))close()}}><p>Create a controlled request draft. Nothing is delivered until an authorized user reviews and sends it.</p><label>Document<select name="documentType">{["INTAKE_CHECKLIST","FACE_SHEET","RIGHTS_ACKNOWLEDGMENT","ROI"].map(value=><option key={value} value={value}>{pretty(value)}</option>)}</select></label><label>Recipient<select name="recipient"><option value="client">Client</option>{selected.representatives.map(row=><option key={row.id} value={`representative:${row.id}`}>{row.name} · {pretty(row.representativeType)}</option>)}</select></label><label>Delivery method<select name="deliveryChannel"><option value="EMAIL">Email after review</option><option value="MANUAL">Manual follow-up</option><option value="SIGN_NOW">Sign Now</option></select></label><label>Optional due date<input name="dueAt" type="date"/></label><div className="request-menu-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button disabled={busy}>{busy?"Creating draft…":"Create request draft"}</button></div></form>}</ActionPopover>
              </div>:null}
            </div>
            {selected.documentRequests.some(item=>["DRAFT","SENT","OUTSTANDING"].includes(item.status))?<details className="outstanding-document-requests" open={Boolean(initialRequestId)}><summary>{selected.documentRequests.filter(item=>["DRAFT","SENT","OUTSTANDING"].includes(item.status)).length} outstanding document request(s)</summary><div className="compact-request-list">{selected.documentRequests.filter(item=>["DRAFT","SENT","OUTSTANDING"].includes(item.status)).map(item=><article id={`request-${item.id}`} key={item.id}><div><strong>{pretty(item.documentType)}</strong><p>{item.recipientName} · {pretty(item.status)}{item.dueAt?` · due ${date(item.dueAt)}`:""}</p></div>{permissions.includes("client.document.generate")?<div className="action-group">{item.status==="DRAFT"?<button disabled={busy} onClick={()=>requestAction({action:"SEND",requestId:item.id},"Document request sent and is now outstanding.")}>Send request</button>:null}{item.status==="OUTSTANDING"?<button disabled={busy} onClick={()=>requestAction({action:"FOLLOW_UP",requestId:item.id},"Document request follow-up recorded.")}>Follow up</button>:null}<button className="secondary" disabled={busy} onClick={()=>requestAction({action:"CANCEL",requestId:item.id},"Document request canceled; the underlying requirement remains unchanged.")}>Cancel</button><label>Fulfill<select defaultValue="" onChange={event=>{if(event.target.value)void requestAction({action:"LINK_FULFILLMENT",requestId:item.id,documentId:event.target.value},"Document linked and request reconciled.")}}><option value="">Select completed document</option>{selected.documents.filter(document=>document.documentType===item.documentType&&document.status==="COMPLETED").map(document=><option key={document.id} value={document.id}>{document.template.name} · {date(document.generatedAt)}</option>)}</select></label></div>:null}</article>)}</div></details>:null}
            <div className="documents-split">
              <aside className="documents-list-pane" aria-label="Document list">
                <div className="document-list-filters"><label>Search documents<input type="search" value={documentSearch} onChange={event=>setDocumentSearch(event.target.value)} placeholder="Name or type"/></label><label>Status<select value={documentStatus} onChange={event=>setDocumentStatus(event.target.value)}><option value="ALL">All statuses</option>{["DRAFT","READY_FOR_SIGNATURE","PARTIALLY_SIGNED","COMPLETED"].map(value=><option key={value} value={value}>{pretty(value)}</option>)}</select></label></div>
                <div className="document-select-list" role="listbox" aria-label="Available documents">{filteredDocuments.map(document=>{const progress=signatureProgress(document),cycle=selected.renewalSummary.cycles.find(item=>item.documentId===document.id),active=document.id===selectedDocument?.id,lifecycle=documentLifecycle(document,cycle);return <button type="button" role="option" aria-selected={active} className={`document-select-card${active?" selected":""}`} id={`document-${document.id}`} key={document.id} onClick={()=>setSelectedDocumentId(document.id)}><span><strong>{document.template.name}</strong><small>{pretty(lifecycle)} · {date(document.generatedAt)}</small></span><span className="document-card-badges">{document.envelope?<StatusChip tone={document.envelope.status==="COMPLETED"?"good":"warning"}>{progress.completed}/{progress.total} signed</StatusChip>:null}{cycle?<StatusChip tone={cycle.status==="CURRENT"?"good":"warning"}>{pretty(cycle.status)}</StatusChip>:null}{document.signatureIntegrityIssue?<StatusChip tone="danger">Evidence issue</StatusChip>:null}{document.renewalOfDocumentId?<span className="renewal-badge">Renewal</span>:null}{document.source==="IMPORTED"?<span className="renewal-badge">Imported original</span>:null}</span></button>})}{!filteredDocuments.length?<p className="empty-state">No documents match these filters.</p>:null}</div>
              </aside>
              <div className="document-detail-pane">
                {selectedDocument?<>
                  <header className="document-detail-header"><div><p className="eyebrow">{selectedDocument.source==="IMPORTED"?"Imported original":"Platform generated document"}</p><h3>{selectedDocument.template.name}</h3><p>{pretty(documentLifecycle(selectedDocument,selectedRenewal))} · version {selectedDocument.template.versionNumber} · created {date(selectedDocument.generatedAt)}</p></div>{permissions.includes("client.document.read")?<a className="button secondary" href={selectedDocumentUrl}>Download PDF</a>:null}</header>
                  {permissions.includes("client.document.read")?<DocumentPdfViewer key={`${selectedDocument.id}:${selectedArtifact}`} title={`${selectedDocument.template.name} authoritative ${selectedArtifact} rendition`} src={`${selectedDocumentUrl}&disposition=inline`}/>:<p>You do not have permission to view document contents.</p>}
                  <section className="document-context-actions" aria-label="Selected document actions">
                    <div><h4>Document status</h4><p>The preview shows the <strong>{selectedArtifact}</strong> rendition. {selectedDocument.envelope&&signatureProgress(selectedDocument).completed>0?"It includes every accepted signature recorded so far.":"No accepted signature is hidden by an unsigned source preview."}</p>{selectedDocument.source==="IMPORTED"&&selectedDocument.status==="COMPLETED"?<p>Accepted as already complete historical evidence. Compliance Platform did not witness or create its prior signatures.</p>:null}{selectedDocument.signatureIntegrityIssue?<p role="alert">Stored completion evidence is incomplete. This cycle remains fail-closed.</p>:null}{selectedDraftEditable&&selectedDocument.documentType==="INTAKE_CHECKLIST"?<p>The Intake Checklist is derived from guided-intake evidence. Update the intake source and generate a new checklist when corrections are required.</p>:null}{selectedDraftEditable&&selectedDocument.documentType==="FACE_SHEET"&&selected?.intakes[0]?.status!=="COMPLETED"?<p>Complete corrections in the active guided intake. The current Face Sheet draft will be regenerated from the reviewed intake data.</p>:null}</div>
                    {permissions.includes("client.document.generate")&&selectedDraftEditable?<div className="document-context-action-buttons"><button className="document-ready-action" disabled={busy} onClick={()=>documentAction({action:"FINALIZE",documentId:selectedDocument.id},"Document is ready for a new signature workflow.")}>Ready for Signature</button>{selectedSupportsEditor?<button className="document-edit-action" disabled={busy} onClick={()=>beginDocumentEdit(selectedDocument)}>Edit document</button>:null}<button className="document-delete-action" disabled={busy} onClick={()=>deleteDraft(selectedDocument)}>Delete draft</button></div>:null}
                    {permissions.includes("client.signature.manage")&&selectedDocument.status==="READY_FOR_SIGNATURE"&&!selectedDocument.envelope&&selectedDocument.isCurrentActionable?<SignatureWorkflowPanel document={selectedDocument} busy={busy} onStart={(requirementIndex,method,signers,confirmed)=>startSignature(selectedDocument.id,requirementIndex,method,signers,confirmed)}/>:null}
                  </section>
                  {documentEditorOpen&&selectedSupportsEditor&&selectedDocument.documentType!=="FACE_SHEET"?<form className="document-editor" onSubmit={reviseDocumentSpecific}><div className="section-heading"><div><h4>Edit {selectedDocument.template.name}</h4><p>Saving creates a new draft version and preserves this version in audit history.</p></div><button type="button" className="secondary" onClick={()=>setDocumentEditorOpen(false)}>Cancel</button></div>{selectedDocument.documentType==="RIGHTS_ACKNOWLEDGMENT"?<><label>Written copy received<input name="writtenCopyReceivedDate" type="date" required defaultValue={String(selectedDocument.snapshotJson?.form?.writtenCopyReceivedDate??"").slice(0,10)}/></label><label>Rights explained<input name="rightsExplainedDate" type="date" required defaultValue={String(selectedDocument.snapshotJson?.form?.rightsExplainedDate??"").slice(0,10)}/></label><label>Explanation method<select name="explanationMethod" required defaultValue={String(selectedDocument.snapshotJson?.form?.explanationMethod??"IN_PERSON")}>{["IN_PERSON","PHONE_VIDEO","INTERPRETER","EASY_READ_VISUAL","OTHER"].map(value=><option key={value} value={value}>{pretty(value)}</option>)}</select></label><label>Explanation notes<textarea name="explanationNotes" defaultValue={String(selectedDocument.snapshotJson?.form?.explanationNotes??"")}/></label><label>Annual review date<input name="annualReviewDate" type="date" defaultValue={String(selectedDocument.snapshotJson?.form?.annualReviewDate??"").slice(0,10)}/></label><label>Grievance contact<input name="grievanceContact" defaultValue={String(selectedDocument.snapshotJson?.form?.grievanceContact??"")}/></label><label>Grievance phone or email<input name="grievancePhoneEmail" defaultValue={String(selectedDocument.snapshotJson?.form?.grievancePhoneEmail??"")}/></label></>:<><label>Direction<select name="direction" defaultValue={String(selectedDocument.snapshotJson?.roi?.direction??"RELEASE_TO")}><option value="RELEASE_TO">Release to</option><option value="RECEIVE_FROM">Receive from</option><option value="BOTH">Both</option></select></label><label>Recipient name<input name="recipientName" required defaultValue={String(selectedDocument.snapshotJson?.roi?.recipientName??"")}/></label><fieldset><legend>Information categories</legend>{["FACE_SHEET_CONTACT","CSSP_ADDENDUM","ASSESSMENTS","PROGRESS_REPORTS","MEDICAL_HEALTH","MEDICATION","INCIDENT_REPORTS","BEHAVIOR_SUPPORT","SCHEDULES_ATTENDANCE","BILLING","OTHER"].map(value=><label key={value}><input type="checkbox" name="categories" value={value} defaultChecked={Array.isArray(selectedDocument.snapshotJson?.roi?.categories)&&selectedDocument.snapshotJson.roi.categories.includes(value)}/>{pretty(value)}</label>)}</fieldset><fieldset><legend>Purposes</legend>{["SERVICE_COORDINATION","SERVICE_PLANNING_TEAM_MEETINGS","HEALTH_CARE","BILLING_FUNDING","PERSON_REPRESENTATIVE_REQUEST","OTHER"].map(value=><label key={value}><input type="checkbox" name="purposes" value={value} defaultChecked={Array.isArray(selectedDocument.snapshotJson?.roi?.purposes)&&selectedDocument.snapshotJson.roi.purposes.includes(value)}/>{pretty(value)}</label>)}</fieldset><label>Effective date<input name="effectiveDate" type="date" required defaultValue={String(selectedDocument.snapshotJson?.roi?.effectiveDate??"").slice(0,10)}/></label><label>Expiration date<input name="expirationDate" type="date" required defaultValue={String(selectedDocument.snapshotJson?.roi?.expirationDate??"").slice(0,10)}/></label><label>Expiration event<input name="expirationEvent" defaultValue={String(selectedDocument.snapshotJson?.roi?.expirationEvent??"")}/></label></>}<button disabled={busy}>{busy?"Saving…":"Save as new draft version"}</button></form>:null}
                  {selectedDocument.envelope?(()=>{const envelope=selectedDocument.envelope!,progress=signatureProgress(selectedDocument);return <section className="selected-signature-progress"><div className="section-heading"><div><h4>Signing progress</h4><p><strong>{progress.completed} of {progress.total}</strong> required signatures completed · {progress.pending} pending</p></div>{envelope.status==="COMPLETED"&&!selectedDocument.signatureIntegrityIssue?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/signatures?envelopeId=${envelope.id}`}>Download signature evidence</a>:null}</div>{envelope.signers.map((signer,index)=><div className="signature-row" key={signer.id}><span><strong>{signer.name}</strong><small>{pretty(signer.role)} · {signer.status==='SIGNED'?'completed':pretty(invitationState(signer))}</small><small>{signer.signedAt?`Signed ${date(signer.signedAt)}`:signer.email??'Recipient email not recorded'}</small></span><ManagedSignerActions document={selectedDocument} signerIndex={index} busy={busy} onAction={signatureAction} onStart={(requirementIndex,method,signers,confirmed)=>startSignature(selectedDocument.id,requirementIndex,method,signers,confirmed)}/></div>)}{!["COMPLETED","VOIDED"].includes(envelope.status)?<form className="inline-form" onSubmit={event=>{event.preventDefault();const reason=new FormData(event.currentTarget).get("reason");void signatureAction({action:"CANCEL",envelopeId:envelope.id,reason},"Signing cycle voided and all active invitations revoked; signatures were not transferred.")}}><label>Cancellation reason<input name="reason" required/></label><button className="secondary" disabled={busy}>Cancel and revoke invitations</button></form>:null}</section>})():null}
                  {selectedRenewal?<details className="selected-renewal"><summary>Renewal details · {pretty(selectedRenewal.status)}</summary><p>Completed {date(selectedRenewal.completedAt)} · renewal due {date(selectedRenewal.dueDate)}</p>{permissions.includes("client.document.generate")&&!selectedRenewal.workflow?<>{selectedRenewal.documentType==="RIGHTS_ACKNOWLEDGMENT"?<form className="inline-form" onSubmit={event=>renewRights(event,selectedRenewal.documentId)}><label>Written copy received<input name="writtenCopyReceivedDate" type="date" required/></label><label>Rights explained<input name="rightsExplainedDate" type="date" required/></label><label>Explanation method<select name="explanationMethod"><option value="IN_PERSON">In person</option><option value="PHONE_VIDEO">Phone / video</option><option value="INTERPRETER">Interpreter</option><option value="EASY_READ_VISUAL">Easy-read / visual</option><option value="OTHER">Other</option></select></label><label>Annual review date<input name="annualReviewDate" type="date"/></label><label>Grievance contact<input name="grievanceContact"/></label><label>Grievance phone/email<input name="grievancePhoneEmail"/></label><button disabled={busy}>Create renewal draft</button></form>:<form className="inline-form" onSubmit={event=>renewRoi(event,selectedRenewal.documentId)}><label>Direction<select name="direction"><option value="BOTH">Both</option><option value="RELEASE_TO">Release to</option><option value="RECEIVE_FROM">Receive from</option></select></label><label>Recipient<input name="recipientName" required/></label><label>Effective date<input name="effectiveDate" type="date" required/></label><label>Expiration date<input name="expirationDate" type="date" required/></label><button disabled={busy}>Create renewal draft</button></form>}</>:<p>{selectedRenewal.workflow?`Renewal workflow: ${pretty(selectedRenewal.workflow.status)}`:"No renewal action is available."}</p>}</details>:null}
                </>:<div className="empty-state"><h3>No documents yet</h3><p>Generate, import, or request a document to begin.</p></div>}
              </div>
            </div>
          </section>:null}
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
                {envelope.signers.map((signer,signerIndex)=>{const state=invitationState(signer),invitation=signer.invitations[0];return <div className="signature-row" key={signer.id}><span><strong>{signer.name}</strong><small>{pretty(signer.role)} · {signer.status==="SIGNED"?"completed":pretty(state)}</small><small>{signer.email??"Recipient email not recorded"}{signer.signedAt?` · Signed ${date(signer.signedAt)}`:invitation?` · Invited ${date(invitation.createdAt)} · Expires ${date(invitation.expiresAt)}`:""}{signer.verificationMethod?` · ${pretty(signer.verificationMethod)}`:""}</small></span><ManagedSignerActions document={document} signerIndex={signerIndex} busy={busy} onAction={signatureAction} onStart={(requirementIndex,method,signers,confirmed)=>startSignature(document.id,requirementIndex,method,signers,confirmed)}/></div>})}
                {!["COMPLETED","VOIDED"].includes(envelope.status)?<form className="inline-form" onSubmit={event=>{event.preventDefault();const reason=new FormData(event.currentTarget).get("reason");void signatureAction({action:"CANCEL",envelopeId:envelope.id,reason},"Signing cycle voided and all active invitations revoked; signatures were not transferred.")}}><label>Cancellation reason<input name="reason" required/></label><button disabled={busy}>Cancel and revoke invitations</button></form>:envelope.voidReason?<p>Cancellation reason: {envelope.voidReason}</p>:null}
              </article>;
            })}
          </section> : null}
          {tab === "Contacts" ? <section><h3>Contacts and representatives</h3><p>Only people associated with this client in the current tenant are shown.</p>{selected.contacts.map(item=><article key={`${item.professionalContact.id}:${item.role}`}><p className="eyebrow">{pretty(item.role)} · reusable professional contact</p><h4>{item.professionalContact.name}</h4><p>{item.professionalContact.agency??"No agency"} · {item.professionalContact.email??"No email"} · {item.professionalContact.phone??"No phone"}</p></article>)}{selected.representatives.map(item=><article key={item.id}><p className="eyebrow">{pretty(item.representativeType)}</p><h4>{item.name}</h4><p>{item.relationship??"Relationship not recorded"} · {item.email??"No email"}</p></article>)}{selected.emergencyContacts.map(item=><article key={item.id}><p className="eyebrow">Emergency contact</p><h4>{item.name}</h4><p>{item.relationship} · {item.phone}{item.informationSharingAllowed?" · information sharing authorized":" · no information-sharing authorization recorded"}</p></article>)}{!selected.contacts.length&&!selected.representatives.length&&!selected.emergencyContacts.length?<div className="empty-state">No contacts or representatives are recorded.</div>:null}{permissions.includes("client.intake.manage")?<button onClick={()=>selected.intakes[0]?.status==="COMPLETED"?editCompletedIntake("REPRESENTATIVE"):setTab("Intake")}>Manage through guided intake</button>:null}</section>:null}
          {tab === "History" ? <section><h3>Client history and provenance</h3><p>Historical completed documents, signatures, imports, renewals, and lifecycle records remain immutable.</p>{selected.documents.filter(item=>item.isHistoricalDuplicate).map(item=><article key={`duplicate:${item.id}`}><p className="eyebrow">Superseded draft · preserved history</p><h4>{item.template.name}</h4><p>Created {date(item.generatedAt)}. A newer equivalent document is the only actionable cycle.</p>{permissions.includes("client.document.read")?<a href={`/api/organizations/${organizationId}/clients/${selected.id}/documents?documentId=${item.id}`}>View preserved draft</a>:null}</article>)}{selected.importSessions.map(item=><article key={item.id}><p className="eyebrow">Import · {pretty(item.status)}</p><h4>{item._count.documents} preserved document(s)</h4><p>{item.confirmedAt?`Confirmed ${date(item.confirmedAt)}`:`Updated ${date(item.updatedAt)}`} · {item._count.proposals} reviewed proposal(s)</p></article>)}{selected.history.length?selected.history.map(item=><article key={item.id}><p className="eyebrow">{date(item.occurredAt)} · {pretty(item.entityType)}</p><h4>{pretty(item.eventType.replace(/^client\./,""))}</h4><p>{item.actor?.email?`Recorded by ${item.actor.email}`:"Recorded by the platform workflow"}</p></article>):<div className="empty-state">No material client events have been recorded.</div>}</section> : null}
        </section>
      ) : null}
      <AddClientDrawer open={addClientOpen} organizationId={organizationId} headers={headers} onClose={()=>setAddClientOpen(false)} onClientCreated={clientId=>window.location.assign(`/admin/clients/${clientId}?organizationId=${encodeURIComponent(organizationId)}&view=Intake`)} onImportCreated={sessionId=>window.location.assign(`/admin/clients?organizationId=${encodeURIComponent(organizationId)}&importSessionId=${encodeURIComponent(sessionId)}`)}/>
    </main></PortalShell>
  );
}
