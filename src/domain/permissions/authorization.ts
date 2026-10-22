import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { isMasterAccount, masterAccountEmails } from "@/domain/permissions/master-account";

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
  if (masterAccountEmails().length) {
    const membership = await prisma.organizationMembership.findUnique({ where: { id: membershipId }, select: { userId: true, status: true } });
    if (membership?.status === "ACTIVE" && await isMasterAccount(membership.userId)) return new Set((await prisma.permission.findMany({ select: { code: true } })).map(row => row.code));
  }
  const [rows, overrides] = await Promise.all([
    prisma.permission.findMany({ where: { roles: { some: { roleDefinition: { memberships: { some: { membershipId } } } } } }, select: { code: true } }),
    prisma.membershipPermission.findMany({ where: { membershipId }, select: { effect: true, permission: { select: { code: true } } } }),
  ]);
  const effective = new Set(rows.map((row) => row.code));
  for (const override of overrides) if (override.effect === "GRANT") effective.add(override.permission.code);
  // Compatibility aliases preserve the authority of pre-split billing roles during rollout.
  if (effective.has("billing.view_billed")) effective.add("billing.view");
  if (effective.has("billing.run")) for (const code of ["billing.view", "billing.initiate", "billing.mapping.manage", "billing.sync.manage"]) effective.add(code);
  // Explicit restrictions always win over role defaults and explicit grants.
  for (const override of overrides) if (override.effect === "DENY") effective.delete(override.permission.code);
  return effective;
}

export async function requirePermission(membershipId: string, permissionCode: string) {
  const effective = await resolvePermissionCodes(membershipId);
  if (!effective.has(permissionCode)) throw new AuthorizationError(`Missing permission: ${permissionCode}`);
  return prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
}

export async function requireEmployeeAccess(user: Pick<User, "id">, organizationId: string, employeeId: string, permission = "employee.read") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { duties: { include: { dutyDefinition: true } } } });
  if (!employee) throw new ResourceNotFoundError("Employee not found");
  return { membership, employee };
}

export async function requireOrganizationOwner(user: Pick<User, "id">, organizationId: string) {
  const { organization, membership } = await requireOrganizationAccess(user, organizationId);
  const ownerRole = membership.roles.some(role => isOrganizationOwnerRole(role.roleDefinition, organizationId));
  if (!ownerRole) throw new AuthorizationError("Organization-owner training assistance is required");
  return { organization, membership };
}

export function isOrganizationOwnerRole(role: { code: string; organizationId: string | null; isPlatformStandard: boolean }, organizationId: string) {
  if (role.code !== "ORGANIZATION_OWNER") return false;
  return (role.isPlatformStandard && role.organizationId === null) || (!role.isPlatformStandard && role.organizationId === organizationId);
}

export function assertRoleAssignableToOrganization(role: { organizationId: string | null; isPlatformStandard: boolean }, organizationId: string) {
  if (!(role.isPlatformStandard && role.organizationId === null) && role.organizationId !== organizationId) {
    throw new AuthorizationError("Role belongs to a different organization");
  }
}

export async function requireEmployeeSelfAccess(user: Pick<User,"id">,organizationId:string,employeeId:string){await requireOrganizationMembership(user.id,organizationId);const employee=await prisma.employee.findFirst({where:{id:employeeId,organizationId,userId:user.id,employmentStatus:{in:["PENDING","ACTIVE"]}}});if(!employee)throw new AuthorizationError("Employee self-access denied");return employee;}
