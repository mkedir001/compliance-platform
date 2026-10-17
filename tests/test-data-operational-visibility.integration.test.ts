import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { getEmployerDashboard, getWorkforceDirectory } from "@/domain/admin/service";
import { reconcileClientLinks } from "@/domain/axiscare/sync";
import { listClients } from "@/domain/clients/service";
import { markTestData, searchCleanupCandidates } from "@/domain/test-data-cleanup/service";

const db = new PrismaClient();

describe.sequential("explicit test-data operational visibility", () => {
  let organizationId="",otherOrganizationId="",emptyOrganizationId="",ownerId="",viewerId="",markedClientId="",markedEmployeeId="",realClientId="",realEmployeeId="";
  const owner=()=>({id:ownerId}),viewer=()=>({id:viewerId});

  beforeAll(async()=>{
    const tag=`visibility-${Date.now()}`,[organization,other,empty,ownerUser,viewerUser]=await Promise.all([
      db.organization.create({data:{legalName:tag,displayName:tag,slug:tag}}),
      db.organization.create({data:{legalName:`${tag}-other`,displayName:`${tag}-other`,slug:`${tag}-other`}}),
      db.organization.create({data:{legalName:`${tag}-empty`,displayName:`${tag}-empty`,slug:`${tag}-empty`}}),
      db.user.create({data:{email:`${tag}-owner@example.test`,status:"ACTIVE"}}),
      db.user.create({data:{email:`${tag}-viewer@example.test`,status:"ACTIVE"}}),
    ]);organizationId=organization.id;otherOrganizationId=other.id;emptyOrganizationId=empty.id;ownerId=ownerUser.id;viewerId=viewerUser.id;
    const permissions=await db.permission.findMany({where:{code:{in:["client.read","compliance.operations.read"]}}}),ownerRole=await db.roleDefinition.findFirstOrThrow({where:{organizationId:null,code:"ORGANIZATION_OWNER"}}),viewerRole=await db.roleDefinition.create({data:{organizationId,code:`VISIBILITY_VIEWER_${Date.now()}`,name:"Operational viewer",scope:"ORGANIZATION",permissions:{create:permissions.map(permission=>({permissionId:permission.id}))}}}),ownerMembership=await db.organizationMembership.create({data:{organizationId,userId:ownerId,status:"ACTIVE"}}),emptyOwnerMembership=await db.organizationMembership.create({data:{organizationId:emptyOrganizationId,userId:ownerId,status:"ACTIVE"}}),viewerMembership=await db.organizationMembership.create({data:{organizationId,userId:viewerId,status:"ACTIVE"}});
    await db.membershipRole.createMany({data:[{membershipId:ownerMembership.id,roleDefinitionId:ownerRole.id},{membershipId:emptyOwnerMembership.id,roleDefinitionId:ownerRole.id},{membershipId:viewerMembership.id,roleDefinitionId:viewerRole.id}]});
    const [realClient,markedClient,realEmployee,markedEmployee]=await Promise.all([
      db.client.create({data:{organizationId,createdByUserId:ownerId,legalFirstName:"Operational",legalLastName:"Client",status:"ACTIVE"}}),
      db.client.create({data:{organizationId,createdByUserId:ownerId,legalFirstName:"Synthetic",legalLastName:"Client",status:"PROSPECTIVE"}}),
      db.employee.create({data:{organizationId,firstName:"Operational",lastName:"Employee",employmentStatus:"ACTIVE"}}),
      db.employee.create({data:{organizationId,firstName:"Synthetic",lastName:"Employee",employmentStatus:"ACTIVE"}}),
    ]);realClientId=realClient.id;markedClientId=markedClient.id;realEmployeeId=realEmployee.id;markedEmployeeId=markedEmployee.id;
    await markTestData(owner(),organizationId,{type:"CLIENT",id:markedClient.id,version:markedClient.updatedAt.toISOString(),reason:"Confirmed synthetic visibility fixture",confirmation:"MARK AS TEST DATA"});
    await markTestData(owner(),organizationId,{type:"EMPLOYEE",id:markedEmployee.id,version:markedEmployee.updatedAt.toISOString(),reason:"Confirmed synthetic visibility fixture",confirmation:"MARK AS TEST DATA"});
    await db.client.create({data:{organizationId:otherOrganizationId,createdByUserId:ownerId,legalFirstName:"Foreign",legalLastName:"Client",testDataMarkedAt:new Date()}});
  });

  it("hides only explicitly marked records by default and labels authorized inclusion",async()=>{
    const clients=await listClients(owner(),organizationId),employees=await getWorkforceDirectory(owner(),organizationId);
    expect(clients.map(row=>row.id)).toContain(realClientId);expect(clients.map(row=>row.id)).not.toContain(markedClientId);
    expect(employees.items.map(row=>row.id)).toContain(realEmployeeId);expect(employees.items.map(row=>row.id)).not.toContain(markedEmployeeId);
    expect((await listClients(owner(),organizationId,{includeTestData:true})).find(row=>row.id===markedClientId)?.isTestData).toBe(true);
    expect((await getWorkforceDirectory(owner(),organizationId,{includeTestData:true})).items.find(row=>row.id===markedEmployeeId)?.isTestData).toBe(true);
  });

  it("returns stable empty operational views for an authorized empty tenant",async()=>{
    expect(await listClients(owner(),emptyOrganizationId)).toEqual([]);
    expect((await getWorkforceDirectory(owner(),emptyOrganizationId)).items).toEqual([]);
    expect((await getEmployerDashboard(owner(),emptyOrganizationId)).activeWorkforce).toBe(0);
  });

  it("keeps inclusion owner-only, tenant-scoped, and default-off for search",async()=>{
    await expect(listClients(viewer(),organizationId,{includeTestData:true})).rejects.toThrow(/organization.manage/);
    await expect(getWorkforceDirectory(viewer(),organizationId,{includeTestData:true})).rejects.toThrow(/organization.manage/);
    expect(await listClients(viewer(),organizationId,{search:"Synthetic"})).toEqual([]);
    expect((await getWorkforceDirectory(viewer(),organizationId,{search:"Synthetic"})).items).toEqual([]);
  });

  it("removes marked workers from operational counts while cleanup and audit retain them",async()=>{
    expect((await getEmployerDashboard(owner(),organizationId)).activeWorkforce).toBe(1);
    expect((await searchCleanupCandidates(owner(),organizationId,{type:"CLIENT",search:"Synthetic"})).map(row=>row.id)).toContain(markedClientId);
    expect((await searchCleanupCandidates(owner(),organizationId,{type:"EMPLOYEE",search:"Synthetic"})).map(row=>row.id)).toContain(markedEmployeeId);
    expect(await db.auditEvent.count({where:{organizationId,eventType:"test_data.marked",entityId:{in:[markedClientId,markedEmployeeId]}}})).toBe(2);
  });

  it("excludes marked clients from AxisCare proposals without mutating records",async()=>{
    await db.axisCareRecord.create({data:{organizationId,entity:"client",externalId:"test-data-axis",payload:{id:"test-data-axis",firstName:"Synthetic",lastName:"Client"},payloadHash:"test-data-axis"}});
    const before=await db.client.findUniqueOrThrow({where:{id:markedClientId}}),result=await reconcileClientLinks(organizationId),after=await db.client.findUniqueOrThrow({where:{id:markedClientId}});
    expect(result.suggested).toBe(0);expect(await db.axisCareClientMatch.count({where:{organizationId,clientId:markedClientId}})).toBe(0);
    expect(after).toEqual(before);
  });
});
