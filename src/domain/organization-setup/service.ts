import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError } from "@/domain/auth/errors";
import { requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

const optionalText = z.string().trim().max(255).nullish().transform(value => value || null);
const profileSchema = z.object({
  legalName: z.string().trim().min(2).max(255), displayName: z.string().trim().min(2).max(255),
  email: z.string().trim().email().nullish().transform(value => value || null), phone: optionalText,
  timezone: z.string().trim().min(3).max(100).refine(value => { try { Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone"),
  addressLine1: optionalText, addressLine2: optionalText, city: optionalText,
  state: z.string().trim().length(2).nullish().transform(value => value?.toUpperCase() || null), postalCode: optionalText, country: optionalText,
}).strict();
const licenseSchema = z.object({ licenseType: z.enum(["MN_245D","MN_144G","MN_144A","MN_245I","OTHER"]), licenseNumber: optionalText, licenseStatus: z.enum(["ACTIVE","PENDING"]).default("PENDING") }).strict();
type SetupState = "COMPLETE"|"ACTION_REQUIRED"|"NOT_APPLICABLE"|"OPTIONAL"|"REQUIRES_REVIEW"|"INFORMATIONAL";
type SetupItem = { key:string; label:string; state:SetupState; blocking:boolean; detail:string; href?:string };

async function access(user:Pick<User,"id">,organizationId:string,permission:"organization.read"|"organization.manage") { const result=await requireOrganizationAccess(user,organizationId);await requirePermission(result.membership.id,permission);return result; }
async function supportedPrograms(at=new Date()) { return prisma.complianceRuleset.findMany({where:{status:"ACTIVE",approvedAt:{not:null},contentHash:{not:null},effectiveFrom:{lte:at},OR:[{effectiveUntil:null},{effectiveUntil:{gte:at}}],requirements:{some:{}}},orderBy:{licenseType:"asc"},select:{id:true,licenseType:true,version:true,effectiveFrom:true,effectiveUntil:true,_count:{select:{requirements:true}}}}); }

export async function getOrganizationSetup(user:Pick<User,"id">,organizationId:string) {
  const {organization,membership}=await access(user,organizationId,"organization.manage"),permissions=await resolvePermissionCodes(membership.id),now=new Date();
  const [programs,licenses,activeAdmins,workforce,invitations,policies,trainingVersions,medicationPathways,assignmentRules]=await Promise.all([
    supportedPrograms(now),prisma.organizationLicense.findMany({where:{organizationId,licenseStatus:{not:"ARCHIVED"}},orderBy:{createdAt:"asc"}}),
    prisma.organizationMembership.count({where:{organizationId,status:"ACTIVE",roles:{some:{roleDefinition:{permissions:{some:{permission:{code:"organization.manage"}}}}}}}}),
    prisma.employee.count({where:{organizationId,employmentStatus:{not:"ARCHIVED"}}}),prisma.employeePortalInvitation.groupBy({by:["status"],where:{organizationId},_count:true}),
    prisma.policyVersion.count({where:{status:"PUBLISHED",policy:{organizationId,status:"ACTIVE"}}}),
    prisma.trainingCourseVersion.count({where:{status:{in:["PUBLISHED","ACTIVE"]},course:{ownershipType:"PLATFORM",organizationId:null}}}),
    prisma.medicationQualificationPathway.count({where:{organizationId}}),prisma.serviceAssignmentRequirementRule.count({where:{organizationId,status:"ACTIVE"}}),
  ]);
  const supported=new Set(programs.map(row=>row.licenseType)),configured=licenses.filter(row=>supported.has(row.licenseType)),activeConfigured=configured.filter(row=>row.licenseStatus==="ACTIVE");
  const profileComplete=Boolean(organization.legalName&&organization.displayName&&organization.email&&organization.phone&&organization.timezone);
  const configuredRulesets=programs.filter(row=>configured.some(license=>license.licenseType===row.licenseType));
  const requirementIds=(await prisma.complianceRulesetRequirement.findMany({where:{rulesetId:{in:configuredRulesets.map(row=>row.id)}},select:{requirementVersionId:true}})).map(row=>row.requirementVersionId);
  const [trainingRequirements,trainingObligations,competencyRows]=requirementIds.length?await Promise.all([
    prisma.complianceRequirementVersion.count({where:{id:{in:requirementIds},trainingOptions:{some:{trainingCourseVersion:{status:{in:["PUBLISHED","ACTIVE"]},course:{ownershipType:"PLATFORM",organizationId:null}}}}}}),
    prisma.complianceRequirementVersion.count({where:{id:{in:requirementIds},trainingOptions:{some:{}}}}),
    prisma.complianceRequirementVersion.findMany({where:{id:{in:requirementIds}},select:{competencyDefinition:true,competencyRequirements:{where:{required:true},select:{id:true}}}}),
  ]):[0,0,[]];
  const competencyRequirements=competencyRows.filter(row=>(row.competencyDefinition as {type?:string}|null)?.type==="REQUIRED"||row.competencyRequirements.length).length;
  const items:SetupItem[]=[
    {key:"profile",label:"Organization profile",state:profileComplete?"COMPLETE":"ACTION_REQUIRED",blocking:true,detail:profileComplete?"Core employer contact and timezone information is configured.":"Legal/display name, email, phone, and timezone are required.",href:"/admin/setup#profile"},
    {key:"program",label:"Supported license/program",state:activeConfigured.length?"COMPLETE":"ACTION_REQUIRED",blocking:true,detail:configured.length?`${configured.map(row=>`${row.licenseType} (${row.licenseStatus.toLowerCase()})`).join(", ")} references platform-managed rulesets.`:"Select a platform-supported program; regulatory rules cannot be edited here.",href:"/admin/setup#program"},
    {key:"access",label:"Administrator access",state:activeAdmins>0?"COMPLETE":"ACTION_REQUIRED",blocking:true,detail:`${activeAdmins} active authorized organization administrator(s).`},
    {key:"workforce",label:"Workforce",state:workforce?"COMPLETE":"OPTIONAL",blocking:false,detail:workforce?`${workforce} employee record(s) are available.`:"No employees yet. Add the first employee when ready.",href:"/admin/compliance-operations"},
    {key:"invitations",label:"Employee invitations",state:workforce?(invitations.length?"COMPLETE":"OPTIONAL"):"NOT_APPLICABLE",blocking:false,detail:workforce?"Invitation state is managed in workforce operations.":"Add an employee before issuing an invitation.",href:"/admin/compliance-operations"},
    {key:"training",label:"Training readiness",state:configured.length?(trainingVersions&&trainingRequirements===trainingObligations?"COMPLETE":"ACTION_REQUIRED"):"NOT_APPLICABLE",blocking:configured.length>0,detail:configured.length?`${trainingRequirements} of ${trainingObligations} training-bearing requirement(s) have a mapped current platform version; ${trainingVersions} platform version(s) are available.`:"Configure a supported program first.",href:"/admin/compliance-operations"},
    {key:"policies",label:"Organization policy readiness",state:policies?"COMPLETE":"REQUIRES_REVIEW",blocking:false,detail:policies?`${policies} published employer policy version(s).`:"No employer policy is published. Legal necessity is not inferred by the platform.",href:"/admin/compliance-operations"},
    {key:"evidence",label:"Competency and evidence readiness",state:configured.length?(competencyRequirements?"INFORMATIONAL":"NOT_APPLICABLE"):"NOT_APPLICABLE",blocking:false,detail:competencyRequirements?`${competencyRequirements} requirement(s) may require competency/evidence beyond training. Setup creates no evidence.`:"No configured requirement currently signals additional competency evidence."},
    {key:"medication",label:"Medication clinical governance",state:medicationPathways?"INFORMATIONAL":"NOT_APPLICABLE",blocking:false,detail:medicationPathways?"Clinical qualification remains separately privileged; setup cannot grant it.":"No organization medication pathway is configured."},
    {key:"assignments",label:"Service-assignment guardrails",state:assignmentRules?"COMPLETE":"INFORMATIONAL",blocking:false,detail:assignmentRules?`${assignmentRules} active guardrail rule(s); every employee/service assignment remains individually evaluated.`:"No active assignment rule is currently applicable."},
    {key:"audit",label:"Audit and export access",state:permissions.has("audit.read")&&permissions.has("audit.export")?"COMPLETE":"ACTION_REQUIRED",blocking:true,detail:"Material setup mutations are actor-attributable and tenant scoped."},
  ];
  const blocking=items.filter(item=>item.blocking&&item.state==="ACTION_REQUIRED"),hasSetupActivity=Boolean(configured.length||organization.email||organization.phone||workforce);
  const operationallyReady=blocking.length===0,optionalIncomplete=items.some(item=>["OPTIONAL","REQUIRES_REVIEW","INFORMATIONAL"].includes(item.state));
  const lifecycle=!hasSetupActivity&&!configured.length?"NOT_STARTED":blocking.some(item=>item.key==="training")?"BLOCKED_REQUIRED_SETUP":blocking.length?"IN_PROGRESS":optionalIncomplete?"OPTIONAL_ONLY":"OPERATIONALLY_READY";
  return {organization,licenses,supportedPrograms:programs,readiness:{lifecycle,operationallyReady,meaning:"Platform configuration readiness only; this is not regulatory certification or employee compliance.",blockingKeys:blocking.map(item=>item.key),items},counts:{workforce,invitations:Object.fromEntries(invitations.map(row=>[row.status,row._count])),publishedPolicies:policies,activeConfiguredLicenses:activeConfigured.length}};
}

export async function updateOrganizationProfile(user:Pick<User,"id">,organizationId:string,raw:unknown) {
  await access(user,organizationId,"organization.manage");const input=profileSchema.parse(raw);
  return prisma.$transaction(async tx=>{const before=await tx.organization.findUniqueOrThrow({where:{id:organizationId}}),updated=await tx.organization.update({where:{id:organizationId},data:input});const changed=Object.keys(input).filter(key=>String(before[key as keyof typeof before]??"")!==String(input[key as keyof typeof input]??""));if(changed.length)await tx.auditEvent.create({data:{organizationId,actorUserId:user.id,eventType:"organization.profile_changed",entityType:"Organization",entityId:organizationId,metadataJson:{changedFields:changed} as Prisma.InputJsonValue}});return updated;});
}

export async function configureOrganizationProgram(user:Pick<User,"id">,organizationId:string,raw:unknown) {
  await access(user,organizationId,"organization.manage");const input=licenseSchema.parse(raw),supported=await supportedPrograms();if(!supported.some(row=>row.licenseType===input.licenseType))throw new AuthorizationError("Program is not supported by an active, approved platform ruleset");
  return prisma.$transaction(async tx=>{
    const existing=await tx.organizationLicense.findFirst({where:{organizationId,licenseType:input.licenseType,licenseStatus:{not:"ARCHIVED"}}});
    const authority=input.licenseType==="MN_245D"?"Minnesota Department of Human Services":existing?.issuingAuthority??null;
    const changed=!existing||existing.licenseNumber!==input.licenseNumber||existing.licenseStatus!==input.licenseStatus||existing.issuingAuthority!==authority;
    let license;
    if(!existing)license=await tx.organizationLicense.create({data:{organizationId,licenseType:input.licenseType,licenseNumber:input.licenseNumber,licenseStatus:input.licenseStatus,issuingAuthority:authority}});
    else if(changed)license=await tx.organizationLicense.update({where:{id:existing.id},data:{licenseNumber:input.licenseNumber,licenseStatus:input.licenseStatus,issuingAuthority:authority}});
    else license=existing;
    if(changed)await tx.auditEvent.create({data:{organizationId,actorUserId:user.id,eventType:existing?"organization.program_configuration_changed":"organization.program_configured",entityType:"OrganizationLicense",entityId:license.id,metadataJson:{licenseType:license.licenseType,status:license.licenseStatus} as Prisma.InputJsonValue}});
    return license;
  });
}
