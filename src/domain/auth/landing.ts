import { prisma } from "@/lib/prisma";

export type LandingDestination = { organizationId: string; organizationName: string; experience: "admin" | "employee"; href: string };

export async function resolveAuthenticatedLanding(userId: string): Promise<LandingDestination[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: "ACTIVE", organization: { status: { not: "ARCHIVED" } } },
    include: { organization: { select: { displayName: true } }, roles: { include: { roleDefinition: { include: { permissions: { include: { permission: true } } } } } } },
    orderBy: { organization: { displayName: "asc" } },
  });
  const employeeOrganizations = new Set((await prisma.employee.findMany({ where: { userId, employmentStatus: { in: ["PENDING", "ACTIVE"] } }, select: { organizationId: true } })).map(row => row.organizationId));
  return memberships.flatMap(membership => {
    const permissions = new Set(membership.roles.flatMap(role => role.roleDefinition.permissions.map(item => item.permission.code)));
    const experience = permissions.has("compliance.operations.read") ? "admin" as const : employeeOrganizations.has(membership.organizationId) ? "employee" as const : null;
    if (!experience) return [];
    const path = experience === "admin" ? "/admin/compliance-operations" : "/learn";
    return [{ organizationId: membership.organizationId, organizationName: membership.organization.displayName, experience, href: `${path}?organizationId=${encodeURIComponent(membership.organizationId)}` }];
  });
}
