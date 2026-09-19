import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrganizationAccess, requirePermission, requireEmployeeAccess } from "@/domain/permissions/authorization";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { employeeCreateSchema, employeeDutyAssignmentSchema, employeeUpdateSchema } from "./schemas";
import { reevaluateIfConfigured } from "@/domain/compliance/evaluation/service";

export async function listEmployees(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "employee.read");
  return prisma.employee.findMany({ where: { organizationId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { duties: { include: { dutyDefinition: true } } } });
}
export async function createEmployee(user: Pick<User, "id">, organizationId: string, input: unknown) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "employee.manage");
  const data=employeeCreateSchema.parse(input),existing=await prisma.employee.findFirst({where:{organizationId,OR:[...(data.employeeNumber?[{employeeNumber:{equals:data.employeeNumber,mode:"insensitive" as const}}]:[]),...(data.email?[{email:{equals:data.email,mode:"insensitive" as const}}]:[])]}});if(existing)throw new AuthorizationError("Employee number or email conflicts with an existing workforce record");
  const employee=await prisma.employee.create({ data: { organizationId, ...data } });
  await prisma.auditEvent.create({data:{organizationId,actorUserId:user.id,employeeId:employee.id,eventType:"employee.created",entityType:"Employee",entityId:employee.id,metadataJson:{source:"MANUAL"}}});
  await reevaluateIfConfigured(organizationId,employee.id,"EMPLOYEE_CREATED"); return employee;
}
export async function updateEmployee(user: Pick<User, "id">, organizationId: string, employeeId: string, input: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  const updated=await prisma.employee.update({ where: { id: employee.id }, data: employeeUpdateSchema.parse(input) }); await reevaluateIfConfigured(organizationId,employee.id,"EMPLOYEE_UPDATED"); return updated;
}
export async function assignEmployeeDuty(user: Pick<User, "id">, organizationId: string, employeeId: string, input: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  const data = employeeDutyAssignmentSchema.parse(input);
  const active = await prisma.employeeDuty.findFirst({ where: { employeeId: employee.id, dutyDefinitionId: data.dutyDefinitionId, effectiveUntil: null } });
  if (active) throw new AuthorizationError("Employee already has an active assignment for this duty");
  const duty=await prisma.employeeDuty.create({ data: { employeeId: employee.id, ...data }, include: { dutyDefinition: true } }); await reevaluateIfConfigured(organizationId,employee.id,"DUTY_CHANGED"); return duty;
}
export async function removeEmployeeDuty(user: Pick<User, "id">, organizationId: string, employeeId: string, dutyId: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  const duty = await prisma.employeeDuty.findFirst({ where: { id: dutyId, employeeId } });
  if (!duty) throw new ResourceNotFoundError("Duty assignment not found");
  const ended=await prisma.employeeDuty.update({ where: { id: duty.id }, data: { effectiveUntil: new Date() } }); await reevaluateIfConfigured(organizationId,employeeId,"DUTY_CHANGED"); return ended;
}
