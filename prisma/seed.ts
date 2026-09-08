import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const permissionCodes = ["organization.read","organization.manage","employee.read","employee.manage","training.read","training.manage","recipient.read","recipient.readSensitive","recipient.readDocuments","recipient.uploadDocuments","recipient.assignStaff","clinical.review","medication.approve","audit.read"];
const dutyRows = [
  ["DIRECT_SUPPORT","Direct support"],["UNSUPERVISED_DIRECT_CONTACT","Unsupervised direct contact"],["MEDICATION_ADMINISTRATION","Medication administration"],
  ["MEDICATION_SETUP","Medication setup"],["TRANSPORTATION","Transportation"],["MEAL_PREPARATION","Meal preparation"],["POSITIVE_SUPPORT_IMPLEMENTATION","Positive support implementation"],
  ["MEDICAL_EQUIPMENT_SUPPORT","Medical equipment support"],["SUPERVISION","Supervision"],
] as const;
const roleMap: Record<string,string[]> = {
  ORGANIZATION_OWNER: permissionCodes, COMPLIANCE_ADMIN:["organization.read","employee.read","employee.manage","training.read","training.manage","audit.read"],
  TRAINING_ADMIN:["organization.read","employee.read","training.read","training.manage"], PROGRAM_MANAGER:["organization.read","employee.read","employee.manage","training.read"],
  SUPERVISOR:["organization.read","employee.read","training.read"], CLINICAL_RN:["organization.read","employee.read","clinical.review","medication.approve"],
  TRAINER:["organization.read","employee.read","training.read","training.manage"], DSP:["organization.read","training.read"], AUDITOR:["organization.read","employee.read","training.read","audit.read"],
};
async function main(){
  for(const code of permissionCodes) await db.permission.upsert({where:{code},update:{},create:{code}});
  for(const [code,name] of dutyRows) await db.dutyDefinition.upsert({where:{code},update:{name},create:{code,name}});
  for(const [code,codes] of Object.entries(roleMap)){
    const role=await db.roleDefinition.findFirst({where:{organizationId:null,code}})??await db.roleDefinition.create({data:{code,name:code.split("_").map(x=>x[0]+x.slice(1).toLowerCase()).join(" "),scope:"PLATFORM",isPlatformStandard:true}});
    const permissions=await db.permission.findMany({where:{code:{in:codes}}});
    for(const p of permissions) await db.rolePermission.upsert({where:{roleDefinitionId_permissionId:{roleDefinitionId:role.id,permissionId:p.id}},update:{},create:{roleDefinitionId:role.id,permissionId:p.id}});
  }
  const northstar=await db.organization.upsert({where:{slug:"northstar-support-services"},update:{},create:{legalName:"Northstar Support Services, Inc.",displayName:"Northstar Support Services",slug:"northstar-support-services",state:"MN",country:"US"}});
  const lakeside=await db.organization.upsert({where:{slug:"lakeside-community-services"},update:{},create:{legalName:"Lakeside Community Services, Inc.",displayName:"Lakeside Community Services",slug:"lakeside-community-services",state:"MN",country:"US"}});
  const community=await db.program.upsert({where:{organizationId_code:{organizationId:northstar.id,code:"COMMUNITY"}},update:{},create:{organizationId:northstar.id,name:"Community Supports",code:"COMMUNITY"}});
  const residential=await db.program.upsert({where:{organizationId_code:{organizationId:northstar.id,code:"RESIDENTIAL"}},update:{},create:{organizationId:northstar.id,name:"Residential Supports",code:"RESIDENTIAL"}});
  if(!await db.location.findFirst({where:{organizationId:northstar.id,name:"Northstar Woodbury Site"}})) await db.location.create({data:{organizationId:northstar.id,programId:community.id,name:"Northstar Woodbury Site",city:"Woodbury",state:"MN",country:"US"}});
  if(!await db.location.findFirst({where:{organizationId:northstar.id,name:"Northstar Oakdale Site"}})) await db.location.create({data:{organizationId:northstar.id,programId:residential.id,name:"Northstar Oakdale Site",city:"Oakdale",state:"MN",country:"US"}});
  const owner=await db.user.upsert({where:{email:"alex.owner@example.test"},update:{},create:{email:"alex.owner@example.test",status:"ACTIVE"}});
  const viewer=await db.user.upsert({where:{email:"jordan.viewer@example.test"},update:{},create:{email:"jordan.viewer@example.test",status:"ACTIVE"}});
  const shared=await db.user.upsert({where:{email:"taylor.shared@example.test"},update:{},create:{email:"taylor.shared@example.test",status:"ACTIVE"}});
  const ownerRole=(await db.roleDefinition.findFirstOrThrow({where:{organizationId:null,code:"ORGANIZATION_OWNER"}})); const auditorRole=await db.roleDefinition.findFirstOrThrow({where:{organizationId:null,code:"AUDITOR"}});
  for(const [org,user,role] of [[northstar,owner,ownerRole],[northstar,viewer,auditorRole],[northstar,shared,auditorRole],[lakeside,shared,ownerRole]] as const){ const m=await db.organizationMembership.upsert({where:{organizationId_userId:{organizationId:org.id,userId:user.id}},update:{status:"ACTIVE"},create:{organizationId:org.id,userId:user.id,status:"ACTIVE",joinedAt:new Date()}}); await db.membershipRole.upsert({where:{membershipId_roleDefinitionId:{membershipId:m.id,roleDefinitionId:role.id}},update:{},create:{membershipId:m.id,roleDefinitionId:role.id}}); }
  for(const [org,user,num,first,last] of [[northstar,shared,"1001","Taylor","Morgan"],[lakeside,shared,"1001","Taylor","Morgan"]] as const) if(!await db.employee.findFirst({where:{organizationId:org.id,userId:user.id}})) await db.employee.create({data:{organizationId:org.id,userId:user.id,employeeNumber:num,firstName:first,lastName:last,employmentStatus:"ACTIVE",employmentType:"FULL_TIME"}});
  const noLogin=await db.employee.findFirst({where:{organizationId:northstar.id,employeeNumber:"1002"}}); if(!noLogin) await db.employee.create({data:{organizationId:northstar.id,employeeNumber:"1002",firstName:"Casey",lastName:"Rivera",employmentStatus:"PENDING"}});
  console.log(JSON.stringify({developmentUsers:{owner:{id:owner.id,email:owner.email},viewer:{id:viewer.id,email:viewer.email},multiOrganization:{id:shared.id,email:shared.email}},organizations:{northstar:northstar.id,lakeside:lakeside.id}},null,2));
}
main().finally(()=>db.$disconnect());
