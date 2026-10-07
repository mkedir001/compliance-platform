import { prisma } from "@/lib/prisma";

export type LandingDestination = { organizationId: string; organizationName: string; experience: "admin" | "employee" | "auditor"; href: string };

export async function resolveAuthenticatedLanding(userId: string): Promise<LandingDestination[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: "ACTIVE", organization: { status: { not: "ARCHIVED" } } },
    include: { organization: { select: { displayName: true } }, roles: { include: { roleDefinition: { include: { permissions: { include: { permission: true } } } } } } },
    orderBy: { organization: { displayName: "asc" } },
  });
  const now=new Date(),[employees,auditSessions]=await Promise.all([prisma.employee.findMany({ where: { userId, employmentStatus: { in: ["PENDING", "ACTIVE"] } }, select: { organizationId: true } }),prisma.auditAccessSession.findMany({where:{inspectorUserId:userId,status:"ACTIVE",startsAt:{lte:now},expiresAt:{gt:now}},select:{id:true,organizationId:true}})]),employeeOrganizations = new Set(employees.map(row => row.organizationId)),sessionsByOrganization=new Map<string,typeof auditSessions>();for(const session of auditSessions)sessionsByOrganization.set(session.organizationId,[...(sessionsByOrganization.get(session.organizationId)??[]),session]);
  return memberships.flatMap(membership => {
    const permissions = new Set(membership.roles.flatMap(role => role.roleDefinition.permissions.map(item => item.permission.code)));
    const destinations:LandingDestination[]=[];
    const managementPath=permissions.has("compliance.operations.read")?"/admin/home":permissions.has("client.read")?"/admin/clients":permissions.has("audit.session.manage")?"/admin/audit-access":permissions.has("employee.read")?"/admin/employees":null;
    if(managementPath)destinations.push({organizationId:membership.organizationId,organizationName:membership.organization.displayName,experience:"admin",href:`${managementPath}?organizationId=${encodeURIComponent(membership.organizationId)}`});
    if(employeeOrganizations.has(membership.organizationId))destinations.push({organizationId:membership.organizationId,organizationName:membership.organization.displayName,experience:"employee",href:`/learn?organizationId=${encodeURIComponent(membership.organizationId)}`});
    if(permissions.has("audit.portal.read"))for(const session of sessionsByOrganization.get(membership.organizationId)??[])destinations.push({organizationId:membership.organizationId,organizationName:membership.organization.displayName,experience:"auditor",href:`/audit?sessionId=${encodeURIComponent(session.id)}`});
    return destinations;
  });
}

export async function resolveAuthorizedAdminDestination(userId: string, requestedOrganizationId = "") {
  const destinations = (await resolveAuthenticatedLanding(userId)).filter(destination => destination.experience === "admin");
  if (requestedOrganizationId) return destinations.find(destination => destination.organizationId === requestedOrganizationId) ?? null;
  return destinations.length === 1 ? destinations[0] : null;
}
