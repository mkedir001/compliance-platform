import { AuditPackageScope, PrismaClient, type AuditAccessCategory } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAuditAccessSession,
  getAuditorDocumentPdf,
  getAuditorPackage,
  getAuditorPortal,
  revokeAuditAccessSession,
  updateAuditAccessSession,
} from "@/domain/audit/access";
import { getClient, saveIntake } from "@/domain/clients/service";
import { createRightsRenewal } from "@/domain/clients/documents";
import { createSignatureEnvelope } from "@/domain/clients/signatures";
import { reconcileEmployeeIssues } from "@/domain/compliance-issues/service";
import { updateOrganizationProfile } from "@/domain/organization-setup/service";
import { getEmployeePortal } from "@/domain/portal/service";
import { updateEmployee } from "@/domain/workforce/service";
import { resolveAuthenticatedLanding } from "@/domain/auth/landing";

const db = new PrismaClient();

describe.sequential("temporary scoped auditor access", () => {
  let organizationId:string, otherOrganizationId:string, managerId:string, auditorId:string, caregiverId:string;
  let selectedClientId:string, otherClientId:string, crossTenantClientId:string, selectedEmployeeId:string, otherEmployeeId:string;
  let selectedDocumentId:string, otherDocumentId:string, packageId:string;
  const manager=()=>({id:managerId}), auditor=()=>({id:auditorId}), caregiver=()=>({id:caregiverId});
  const now=Date.now();

  beforeAll(async()=>{
    const tag=`scoped-audit-${now}`;
    const [organization,otherOrganization,managerUser,auditorUser,caregiverUser]=await Promise.all([
      db.organization.create({data:{legalName:tag,displayName:"Scoped Audit Test",slug:tag}}),
      db.organization.create({data:{legalName:`${tag}-other`,displayName:"Other Tenant",slug:`${tag}-other`}}),
      db.user.create({data:{email:`manager-${tag}@example.test`,status:"ACTIVE"}}),
      db.user.create({data:{email:`auditor-${tag}@example.test`,status:"ACTIVE"}}),
      db.user.create({data:{email:`caregiver-${tag}@example.test`,status:"ACTIVE"}}),
    ]);
    organizationId=organization.id;otherOrganizationId=otherOrganization.id;managerId=managerUser.id;auditorId=auditorUser.id;caregiverId=caregiverUser.id;
    const permissions=await db.permission.findMany({where:{code:{in:["audit.session.manage","audit.portal.read"]}}});
    expect(permissions.map(row=>row.code).sort()).toEqual(["audit.portal.read","audit.session.manage"]);
    const managerRole=await db.roleDefinition.create({data:{organizationId,code:"AUDIT_MANAGER",name:"Audit manager",scope:"ORGANIZATION",permissions:{create:permissions.filter(row=>row.code==="audit.session.manage").map(row=>({permissionId:row.id}))}}});
    const auditorRole=await db.roleDefinition.create({data:{organizationId,code:"SCOPED_AUDITOR_TEST",name:"Scoped auditor",scope:"ORGANIZATION",permissions:{create:permissions.filter(row=>row.code==="audit.portal.read").map(row=>({permissionId:row.id}))}}});
    for(const [userId,roleId] of [[managerId,managerRole.id],[auditorId,auditorRole.id]] as const){await db.organizationMembership.create({data:{organizationId,userId,status:"ACTIVE",roles:{create:{roleDefinitionId:roleId}}}})}
    await db.organizationMembership.create({data:{organizationId,userId:caregiverId,status:"ACTIVE"}});
    const [selectedClient,otherClient,crossTenantClient]=await Promise.all([
      db.client.create({data:{organizationId,legalFirstName:"Selected",legalLastName:"Person",dateOfBirth:new Date("1990-01-01"),createdByUserId:managerId,status:"ACTIVE"}}),
      db.client.create({data:{organizationId,legalFirstName:"Hidden",legalLastName:"Person",dateOfBirth:new Date("1991-01-01"),createdByUserId:managerId,status:"ACTIVE"}}),
      db.client.create({data:{organizationId:otherOrganizationId,legalFirstName:"Other",legalLastName:"Tenant",dateOfBirth:new Date("1992-01-01"),createdByUserId:managerId,status:"ACTIVE"}}),
    ]);
    selectedClientId=selectedClient.id;otherClientId=otherClient.id;crossTenantClientId=crossTenantClient.id;
    const [selectedEmployee,otherEmployee]=await Promise.all([
      db.employee.create({data:{organizationId,firstName:"Selected",lastName:"Staff",employmentStatus:"ACTIVE"}}),
      db.employee.create({data:{organizationId,userId:caregiverId,email:caregiverUser.email,firstName:"Care",lastName:"Giver",employmentStatus:"ACTIVE"}}),
    ]);
    selectedEmployeeId=selectedEmployee.id;otherEmployeeId=otherEmployee.id;
    const template=await db.clientDocumentTemplate.create({data:{organizationId,code:"AUDIT-FACE",name:"Audit face sheet",documentType:"FACE_SHEET",versionNumber:1,contentJson:{test:true}}});
    const [selectedDocument,otherDocument]=await Promise.all([
      db.clientDocument.create({data:{organizationId,clientId:selectedClientId,templateId:template.id,documentType:"FACE_SHEET",snapshotJson:{client:"selected"},renderedPdf:Buffer.from("%PDF-scoped"),generatedByUserId:managerId}}),
      db.clientDocument.create({data:{organizationId,clientId:otherClientId,templateId:template.id,documentType:"FACE_SHEET",snapshotJson:{client:"hidden"},renderedPdf:Buffer.from("%PDF-hidden"),generatedByUserId:managerId}}),
    ]);
    selectedDocumentId=selectedDocument.id;otherDocumentId=otherDocument.id;
    packageId=(await db.auditPackage.create({data:{organizationId,scope:AuditPackageScope.ORGANIZATION_COMPLIANCE_SUMMARY,requestedByUserId:managerId,status:"GENERATED",generatedAt:new Date(),recordCount:1,manifestJson:{records:["scoped"]},integrityDigest:"test-digest"}})).id;
  });

  function input(overrides:Record<string,unknown>={}){return{name:"Licensing review",inspectorName:"Test Inspector",inspectorEmail:`auditor-scoped-audit-${now}@example.test`,startsAt:new Date(Date.now()-60_000),expiresAt:new Date(Date.now()+86_400_000),categories:["CLIENTS","CLIENT_DOCUMENTS","STAFF","EVIDENCE","AUDIT_PACKAGES"] as AuditAccessCategory[],clientIds:[selectedClientId],employeeIds:[selectedEmployeeId],includeActiveStaff:false,...overrides}}

  it("creates a user-bound, time-bound, least-privilege session",async()=>{const session=await createAuditAccessSession(manager(),organizationId,input());expect(session.inspectorUserId).toBe(auditorId);expect(session.clients.map(row=>row.clientId)).toEqual([selectedClientId]);expect(session.employees.map(row=>row.employeeId)).toEqual([selectedEmployeeId]);expect(await db.auditEvent.count({where:{organizationId,entityId:session.id,eventType:{in:["audit.access_session_created","audit.access_session_activated"]}}})).toBe(2)});

  it("allows only authorized management to create sessions",async()=>{await expect(createAuditAccessSession(caregiver(),organizationId,input({name:"Forbidden"}))).rejects.toThrow(/audit.session.manage/);await expect(createAuditAccessSession(auditor(),organizationId,input({name:"Forbidden"}))).rejects.toThrow(/audit.session.manage/)});

  it("derives management, employee, and auditor experiences from effective permissions",async()=>{const session=await createAuditAccessSession(manager(),organizationId,input({name:"Landing experience"})),managerLanding=await resolveAuthenticatedLanding(managerId),auditorLanding=await resolveAuthenticatedLanding(auditorId),caregiverLanding=await resolveAuthenticatedLanding(caregiverId);expect(managerLanding).toEqual(expect.arrayContaining([expect.objectContaining({experience:"admin",href:`/admin/audit-access?organizationId=${organizationId}`})]));expect(auditorLanding).toEqual(expect.arrayContaining([expect.objectContaining({experience:"auditor",href:`/audit?sessionId=${session.id}`})]));expect(caregiverLanding).toEqual(expect.arrayContaining([expect.objectContaining({experience:"employee",href:`/learn?organizationId=${organizationId}`})]));expect(caregiverLanding.some(row=>row.experience==="admin")).toBe(false)});

  it("shows only selected clients and staff and permits scoped downloads",async()=>{const session=await createAuditAccessSession(manager(),organizationId,input({name:"Scoped records"})),portal=await getAuditorPortal(auditor(),session.id);expect(portal.session.readOnly).toBe(true);expect(portal.clients.map(row=>row.client.legalFirstName)).toEqual(["Selected"]);expect(portal.staff.map(row=>row.firstName)).toEqual(["Selected"]);expect(JSON.stringify(portal)).not.toContain(selectedClientId);expect(JSON.stringify(portal)).not.toContain(selectedEmployeeId);expect(portal.evidence?.counts).toEqual({trainingCompletions:0,certificates:0,attestations:0,externalTrainingRecords:0});expect(portal.documents.map(row=>row.id)).toEqual([selectedDocumentId]);expect((await getAuditorDocumentPdf(auditor(),session.id,selectedDocumentId)).toString()).toContain("%PDF-scoped");await expect(getAuditorDocumentPdf(auditor(),session.id,otherDocumentId)).rejects.toThrow(/not found in audit scope/);expect((await getAuditorPackage(auditor(),session.id,packageId)).integrityDigest).toBe("test-digest")});

  it("applies scope changes immediately",async()=>{const session=await createAuditAccessSession(manager(),organizationId,input({name:"Scope update"}));await updateAuditAccessSession(manager(),organizationId,session.id,input({name:"Scope update",clientIds:[otherClientId],employeeIds:[otherEmployeeId]}));const portal=await getAuditorPortal(auditor(),session.id);expect(portal.clients.map(row=>row.client.legalFirstName)).toEqual(["Hidden"]);expect(portal.staff.map(row=>row.firstName)).toEqual(["Care"]);await expect(getAuditorDocumentPdf(auditor(),session.id,selectedDocumentId)).rejects.toThrow(/not found in audit scope/)});

  it("enforces expiration, revocation, category scope, user binding, and tenant scope",async()=>{const expired=await createAuditAccessSession(manager(),organizationId,input({name:"Expired",startsAt:new Date(Date.now()-120_000),expiresAt:new Date(Date.now()-60_000)}));await expect(getAuditorPortal(auditor(),expired.id)).rejects.toThrow(/inactive or expired/);const revoked=await createAuditAccessSession(manager(),organizationId,input({name:"Revoked"}));await revokeAuditAccessSession(manager(),organizationId,revoked.id,"Review complete");await expect(getAuditorPortal(auditor(),revoked.id)).rejects.toThrow(/inactive or expired/);const clientsOnly=await createAuditAccessSession(manager(),organizationId,input({name:"Clients only",categories:["CLIENTS"],employeeIds:[]}));await expect(getAuditorDocumentPdf(auditor(),clientsOnly.id,selectedDocumentId)).rejects.toThrow(/outside this audit scope/);await expect(getAuditorPortal(manager(),clientsOnly.id)).rejects.toThrow(/denied/);await expect(createAuditAccessSession(manager(),organizationId,input({clientIds:[crossTenantClientId]}))).rejects.toThrow(/not found/)});

  it("keeps auditor access server-side read-only across operational domains",async()=>{const session=await createAuditAccessSession(manager(),organizationId,input({name:"Read only"}));await expect(getClient(auditor(),organizationId,selectedClientId)).rejects.toThrow(/client.read/);await expect(saveIntake(auditor(),organizationId,selectedClientId,{currentStep:"CLIENT",client:{preferredName:"Forbidden"}})).rejects.toThrow(/client.intake.manage/);await expect(updateEmployee(auditor(),organizationId,selectedEmployeeId,{firstName:"Forbidden"})).rejects.toThrow(/employee.manage/);await expect(createSignatureEnvelope(auditor(),organizationId,selectedClientId,selectedDocumentId,"SIGN_NOW",[{role:"CLIENT",name:"Selected Person"}])).rejects.toThrow(/client.signature.manage/);await expect(createRightsRenewal(auditor(),organizationId,selectedClientId,selectedDocumentId)).rejects.toThrow(/client.document.generate/);await expect(reconcileEmployeeIssues(auditor(),organizationId,selectedEmployeeId)).rejects.toThrow(/compliance_issue.reconcile/);await expect(updateOrganizationProfile(auditor(),organizationId,{displayName:"Forbidden"})).rejects.toThrow(/organization.manage/);expect((await getAuditorPortal(auditor(),session.id)).session.readOnly).toBe(true);expect((await db.client.findUniqueOrThrow({where:{id:selectedClientId}})).preferredName).toBeNull()});

  it("keeps caregivers in self-service without broad client or coworker access",async()=>{const portal=await getEmployeePortal(caregiver(),organizationId);expect(portal.employee.id).toBe(otherEmployeeId);await expect(getClient(caregiver(),organizationId,selectedClientId)).rejects.toThrow(/client.read/);await expect(saveIntake(caregiver(),organizationId,selectedClientId,{currentStep:"CLIENT",client:{preferredName:"Forbidden"}})).rejects.toThrow(/client.intake.manage/)});

  it("records meaningful lifecycle and download audit events",async()=>{const events=await db.auditEvent.findMany({where:{organizationId,eventType:{startsWith:"audit."}},select:{eventType:true}}),types=new Set(events.map(row=>row.eventType));expect(types.has("audit.access_session_created")).toBe(true);expect(types.has("audit.access_session_scope_updated")).toBe(true);expect(types.has("audit.access_session_revoked")).toBe(true);expect(types.has("audit.scoped_document_downloaded")).toBe(true);expect(types.has("audit.scoped_package_downloaded")).toBe(true)});
});
