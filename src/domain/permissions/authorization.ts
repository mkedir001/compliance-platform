import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";

export type MembershipWithRoles = Prisma.OrganizationMembershipGetPayload<{ include: { roles: { include: { roleDefinition: true } } } }>;

export async function requireOrganizationMembership(userId: string, organizationId: string): Promise<MembershipWithRoles> {
  const membership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { roles: { include: { roleDefinition: true } } },
  });
  if (!membership || membership.status !== "ACTIVE") throw new AuthorizationError("Organization access denied");
  return membership;
}

export async function requireOrganizationAccess(user: Pick<User, "id">, organizationId: string) {
  const membership = await requireOrganizationMembership(user.id, organizationId);
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, status: { not: "ARCHIVED" } } });
  if (!organization) throw new ResourceNotFoundError("Organization not found");
  return { organization, membership };
}

export async function resolvePermissionCodes(membershipId: string): Promise<Set<string>> {
  const rows = await prisma.permission.findMany({
    where: { roles: { some: { roleDefinition: { memberships: { some: { membershipId } } } } } },
    select: { code: true },
  });
  return new Set(rows.map((row) => row.code));
}

export async function requirePermission(membershipId: string, permissionCode: string) {
  const permission = await prisma.permission.findFirst({
    where: { code: permissionCode, roles: { some: { roleDefinition: { memberships: { some: { membershipId } } } } } },
  });
  if (!permission) throw new AuthorizationError(`Missing permission: ${permissionCode}`);
  return permission;
}

export async function requireEmployeeAccess(user: Pick<User, "id">, organizationId: string, employeeId: string, permission = "employee.read") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { duties: { include: { dutyDefinition: true } } } });
  if (!employee) throw new ResourceNotFoundError("Employee not found");
  return { membership, employee };
}

export function assertRoleAssignableToOrganization(role: { organizationId: string | null; isPlatformStandard: boolean }, organizationId: string) {
  if (!(role.isPlatformStandard && role.organizationId === null) && role.organizationId !== organizationId) {
    throw new AuthorizationError("Role belongs to a different organization");
  }
}
