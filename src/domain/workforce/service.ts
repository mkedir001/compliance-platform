import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrganizationAccess, requirePermission, requireEmployeeAccess } from "@/domain/permissions/authorization";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { employeeCreateSchema, employeeDutyAssignmentSchema, employeeUpdateSchema } from "./schemas";

export async function listEmployees(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "employee.read");
  return prisma.employee.findMany({ where: { organizationId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { duties: { include: { dutyDefinition: true } } } });
}
export async function createEmployee(user: Pick<User, "id">, organizationId: string, input: unknown) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "employee.manage");
  return prisma.employee.create({ data: { organizationId, ...employeeCreateSchema.parse(input) } });
}
export async function updateEmployee(user: Pick<User, "id">, organizationId: string, employeeId: string, input: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  return prisma.employee.update({ where: { id: employee.id }, data: employeeUpdateSchema.parse(input) });
}
export async function assignEmployeeDuty(user: Pick<User, "id">, organizationId: string, employeeId: string, input: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  const data = employeeDutyAssignmentSchema.parse(input);
  const active = await prisma.employeeDuty.findFirst({ where: { employeeId: employee.id, dutyDefinitionId: data.dutyDefinitionId, effectiveUntil: null } });
  if (active) throw new AuthorizationError("Employee already has an active assignment for this duty");
  return prisma.employeeDuty.create({ data: { employeeId: employee.id, ...data }, include: { dutyDefinition: true } });
}
export async function removeEmployeeDuty(user: Pick<User, "id">, organizationId: string, employeeId: string, dutyId: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage");
  const duty = await prisma.employeeDuty.findFirst({ where: { id: dutyId, employeeId } });
  if (!duty) throw new ResourceNotFoundError("Duty assignment not found");
  return prisma.employeeDuty.update({ where: { id: duty.id }, data: { effectiveUntil: new Date() } });
}
