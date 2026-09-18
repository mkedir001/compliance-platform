import type { EmploymentStatus, User } from "@prisma/client";
import { getEmployeeAuditRecord } from "@/domain/audit/service";
import { computeEmployeeOperationalProfile } from "@/domain/compliance/operations/service";
import { getMedicationEvidence, listMedicationQualifications } from "@/domain/medication/service";
import { getComplianceOperationsSummary, getEmployeeComplianceProfile } from "@/domain/operations/service";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

async function authorize(user: Pick<User,"id">, organizationId: string, permission: string) { const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, permission); return membership; }

export async function getEmployerDashboard(user: Pick<User,"id">, organizationId: string) {
  await authorize(user, organizationId, "compliance.operations.read");
  const [operations, activeWorkforce, invitations, unresolvedIssues, onboardingIncomplete] = await Promise.all([
    getComplianceOperationsSummary(user, organizationId),
    prisma.employee.count({ where: { organizationId, employmentStatus: "ACTIVE" } }),
    prisma.employeePortalInvitation.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.complianceIssue.count({ where: { organizationId, status: { in: ["OPEN","IN_PROGRESS"] } } }),
    prisma.employeeOnboarding.count({ where: { organizationId, status: { notIn: ["READY","COMPLETED","CANCELED"] } } }),
  ]);
  return { organizationId, generatedAt: new Date().toISOString(), activeWorkforce, workforce: operations.workforce.counts, training: { overdue: operations.trainingOverdue, dueSoon: operations.trainingDueSoon, competencyPending: operations.competencyPending }, onboarding: { incomplete: onboardingIncomplete, byStatus: operations.onboarding }, policies: { pendingAcknowledgments: operations.policyAcknowledgmentsPending }, compliance: { unresolvedIssues, overdue: operations.overdueCompliance, byIssueStatus: operations.complianceIssues }, medication: operations.medication, serviceAssignments: operations.serviceAssignments, certificates: operations.certificates, invitations: Object.fromEntries(invitations.map(item=>[item.status,item._count])) };
}

export async function getWorkforceDirectory(user: Pick<User,"id">, organizationId: string, filters: { search?: string; status?: EmploymentStatus; attention?: boolean; page?: number; pageSize?: number } = {}) {
  await authorize(user, organizationId, "compliance.operations.read");
  const page=Math.max(1,filters.page??1),pageSize=Math.max(1,Math.min(filters.pageSize??25,100)),search=filters.search?.trim();
  const where={organizationId,employmentStatus:filters.status,OR:search?[{firstName:{contains:search,mode:"insensitive" as const}},{lastName:{contains:search,mode:"insensitive" as const}},{employeeNumber:{contains:search,mode:"insensitive" as const}},{email:{contains:search,mode:"insensitive" as const}}]:undefined};
  const [total,employees]=await Promise.all([prisma.employee.count({where}),prisma.employee.findMany({where,orderBy:[{lastName:"asc"},{firstName:"asc"}],skip:(page-1)*pageSize,take:pageSize,select:{id:true,employeeNumber:true,firstName:true,lastName:true,email:true,jobTitle:true,employmentStatus:true,hireDate:true,userId:true,portalInvitations:{orderBy:{invitedAt:"desc"},take:1,select:{status:true,invitedAt:true,acceptedAt:true}}}})]);
  const rows=await Promise.all(employees.map(async employee=>{const profile=await computeEmployeeOperationalProfile(organizationId,employee.id);const training=await prisma.trainingAssignment.groupBy({by:["status"],where:{organizationId,employeeId:employee.id},_count:true});return{...employee,portalInvitation:employee.portalInvitations[0]??null,complianceStatus:profile.overallStatus,readiness:profile.readiness.scopes,openActionCount:profile.remediations.length,blockingRequirementCount:profile.requirements.filter(item=>item.blocking).length,training:Object.fromEntries(training.map(item=>[item.status,item._count]))}}));
  const visible=filters.attention?rows.filter(row=>row.complianceStatus!=="READY"||row.openActionCount>0):rows;
  return{organizationId,page,pageSize,total,returned:visible.length,items:visible};
}

export async function getEmployerEmployeeDetail(user: Pick<User,"id">, organizationId: string, employeeId: string) {
  await authorize(user, organizationId, "compliance.operations.read");await requireEmployeeAccess(user,organizationId,employeeId,"employee.read");
  const [profile,medication,medicationEvidence,auditRecord]=await Promise.all([getEmployeeComplianceProfile(user,organizationId,employeeId),listMedicationQualifications(user,organizationId,employeeId),getMedicationEvidence(user,organizationId,employeeId),getEmployeeAuditRecord(user,organizationId,employeeId)]);
  const invitation=await prisma.employeePortalInvitation.findFirst({where:{organizationId,employeeId},orderBy:{invitedAt:"desc"},select:{id:true,invitedEmail:true,status:true,invitedAt:true,acceptedAt:true,revokedAt:true}});
  return{organizationId,employeeId,portalAccess:invitation,profile,medication:{pathways:medication,evidence:medicationEvidence},audit:{knownEvidenceGaps:auditRecord.knownEvidenceGaps,materialAuditHistory:auditRecord.materialAuditHistory,requirementCount:auditRecord.requirements.length}};
}
