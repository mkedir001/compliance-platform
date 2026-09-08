import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeAccess, requireOrganizationMembership, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { assignEmployeeDuty, createEmployee, updateEmployee } from "@/domain/workforce/service";

const db = new PrismaClient();
let orgA: {id:string}, orgB:{id:string}, adminA:{id:string}, adminB:{id:string}, viewerA:{id:string}, shared:{id:string}, employeeA:{id:string}, ownerRole:{id:string}, viewerRole:{id:string}, duty:{id:string};

beforeAll(async()=>{
  const tag=`test-${Date.now()}`;
  [orgA,orgB]=await Promise.all([db.organization.create({data:{legalName:"Test Alpha",displayName:"Test Alpha",slug:`${tag}-a`}}),db.organization.create({data:{legalName:"Test Beta",displayName:"Test Beta",slug:`${tag}-b`}})]);
  [adminA,adminB,viewerA,shared]=await Promise.all(["admin-a","admin-b","viewer-a","shared"].map(x=>db.user.create({data:{email:`${tag}-${x}@example.test`,status:"ACTIVE"}})));
  const manage=await db.permission.upsert({where:{code:"employee.manage"},update:{},create:{code:"employee.manage"}}); const read=await db.permission.upsert({where:{code:"employee.read"},update:{},create:{code:"employee.read"}});
  ownerRole=await db.roleDefinition.create({data:{code:`OWNER-${tag}`,name:"Owner",scope:"PLATFORM",isPlatformStandard:true,permissions:{create:[{permissionId:manage.id},{permissionId:read.id}]}}});
  viewerRole=await db.roleDefinition.create({data:{code:`VIEWER-${tag}`,name:"Viewer",scope:"PLATFORM",isPlatformStandard:true,permissions:{create:{permissionId:read.id}}}});
  const memberships=await Promise.all([[orgA,adminA,ownerRole],[orgB,adminB,ownerRole],[orgA,viewerA,viewerRole],[orgA,shared,viewerRole],[orgB,shared,viewerRole]].map(([o,u,r])=>db.organizationMembership.create({data:{organizationId:o.id,userId:u.id,status:"ACTIVE",roles:{create:{roleDefinitionId:r.id}}}})));
  expect(memberships).toHaveLength(5); employeeA=await db.employee.create({data:{organizationId:orgA.id,employeeNumber:"DUP-1",firstName:"Sam",lastName:"Alpha",employmentStatus:"ACTIVE"}}); duty=await db.dutyDefinition.upsert({where:{code:"TEST_DUTY"},update:{},create:{code:"TEST_DUTY",name:"Test duty"}});
});

describe("tenant and workforce foundation",()=>{
  it("denies organization access without membership",async()=>{await expect(requireOrganizationMembership(adminA.id,orgB.id)).rejects.toBeInstanceOf(AuthorizationError)});
  it("allows same-tenant employee access",async()=>{expect((await requireEmployeeAccess(adminA,orgA.id,employeeA.id)).employee.id).toBe(employeeA.id)});
  it("denies cross-tenant employee access",async()=>{await expect(requireEmployeeAccess(adminB,orgB.id,employeeA.id)).rejects.toBeInstanceOf(ResourceNotFoundError)});
  it("enforces employee.manage",async()=>{const m=await requireOrganizationMembership(viewerA.id,orgA.id);await expect(requirePermission(m.id,"employee.manage")).rejects.toBeInstanceOf(AuthorizationError)});
  it("resolves permission through membership role",async()=>{const m=await requireOrganizationMembership(adminA.id,orgA.id);expect(await resolvePermissionCodes(m.id)).toContain("employee.manage")});
  it("creates employee without login and links account later",async()=>{const e=await createEmployee(adminA,orgA.id,{firstName:"No",lastName:"Login"});expect(e.userId).toBeNull();const u=await db.user.create({data:{email:`link-${Date.now()}@example.test`,status:"ACTIVE"}});expect((await updateEmployee(adminA,orgA.id,e.id,{userId:u.id})).userId).toBe(u.id)});
  it("supports a user in multiple organizations and employments",async()=>{expect(await db.organizationMembership.count({where:{userId:shared.id}})).toBe(2);await db.employee.createMany({data:[{organizationId:orgA.id,userId:shared.id,firstName:"Multi",lastName:"A"},{organizationId:orgB.id,userId:shared.id,firstName:"Multi",lastName:"B"}]});expect(await db.employee.count({where:{userId:shared.id}})).toBe(2)});
  it("scopes employee numbers to organization",async()=>{await db.employee.create({data:{organizationId:orgB.id,employeeNumber:"DUP-1",firstName:"Other",lastName:"Org"}});await expect(db.employee.create({data:{organizationId:orgA.id,employeeNumber:"DUP-1",firstName:"Duplicate",lastName:"Same"}})).rejects.toMatchObject({code:"P2002"})});
  it("assigns multiple duties through employee ownership",async()=>{const d2=await db.dutyDefinition.create({data:{code:`D2-${Date.now()}`,name:"Second"}});await assignEmployeeDuty(adminA,orgA.id,employeeA.id,{dutyDefinitionId:duty.id,effectiveFrom:"2026-01-01"});await assignEmployeeDuty(adminA,orgA.id,employeeA.id,{dutyDefinitionId:d2.id,effectiveFrom:"2026-01-01"});expect(await db.employeeDuty.count({where:{employeeId:employeeA.id}})).toBeGreaterThanOrEqual(2)});
  it("denies cross-tenant mutation",async()=>{await expect(updateEmployee(adminB,orgB.id,employeeA.id,{firstName:"Breach"})).rejects.toBeInstanceOf(ResourceNotFoundError)});
});
