import { Prisma, type EmploymentStatus, type User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

const lifecycleSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "LEAVE", "TERMINATED"]), effectiveDate: z.coerce.date().optional(), reason: z.string().trim().min(3).max(1000) }).strict();
const correctionSchema = z.object({ firstName: z.string().trim().min(1).max(100).optional(), middleName: z.string().trim().max(100).nullable().optional(), lastName: z.string().trim().min(1).max(100).optional(), preferredName: z.string().trim().max(100).nullable().optional(), employeeNumber: z.string().trim().max(255).nullable().optional(), email: z.string().trim().email().nullable().optional(), phone: z.string().trim().max(255).nullable().optional(), hireDate: z.coerce.date().nullable().optional(), jobTitle: z.string().trim().max(255).nullable().optional(), employmentType: z.enum(["FULL_TIME", "PART_TIME", "TEMPORARY", "CONTRACTOR", "VOLUNTEER", "OTHER"]).nullable().optional(), reason: z.string().trim().min(3).max(1000) }).strict();
const safeAssignableRoles = new Set(["COMPLIANCE_ADMIN", "TRAINING_ADMIN", "PROGRAM_MANAGER", "SUPERVISOR", "TRAINER", "DSP", "AUDITOR"]);

async function authorize(user: Pick<User, "id">, organizationId: string, permission: string) { const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, permission); return membership; }
async function audit(organizationId: string, actorUserId: string, employeeId: string, eventType: string, entityType: string, entityId: string, metadataJson?: Prisma.InputJsonValue) { await prisma.auditEvent.create({ data: { organizationId, actorUserId, employeeId, eventType, entityType, entityId, metadataJson } }); }

export async function findPotentialEmployeeDuplicates(user: Pick<User, "id">, organizationId: string, input: { employeeNumber?: string | null; email?: string | null; firstName?: string; lastName?: string; hireDate?: Date | null }, excludeEmployeeId?: string) {
  await authorize(user, organizationId, "employee.read");
  const exact = await prisma.employee.findMany({ where: { organizationId, id: excludeEmployeeId ? { not: excludeEmployeeId } : undefined, OR: [...(input.employeeNumber ? [{ employeeNumber: { equals: input.employeeNumber, mode: "insensitive" as const } }] : []), ...(input.email ? [{ email: { equals: input.email, mode: "insensitive" as const } }] : [])] }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, email: true, hireDate: true }, take: 10 });
  const potential = input.firstName && input.lastName ? await prisma.employee.findMany({ where: { organizationId, id: excludeEmployeeId ? { not: excludeEmployeeId } : undefined, firstName: { equals: input.firstName, mode: "insensitive" }, lastName: { equals: input.lastName, mode: "insensitive" }, ...(input.hireDate ? { hireDate: input.hireDate } : {}) }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, email: true, hireDate: true }, take: 10 }) : [];
  return { exactConflicts: exact, potentialDuplicates: potential.filter(row => !exact.some(item => item.id === row.id)), automaticMergePerformed: false };
}

export async function transitionEmployeeLifecycle(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage"), input = lifecycleSchema.parse(raw);
  if (employee.employmentStatus === input.status) return { employee, changed: false };
  const transitions: Record<EmploymentStatus, EmploymentStatus[]> = { PENDING: ["ACTIVE", "TERMINATED"], ACTIVE: ["LEAVE", "TERMINATED"], LEAVE: ["ACTIVE", "TERMINATED"], TERMINATED: ["ACTIVE"], ARCHIVED: [] };
  if (!transitions[employee.employmentStatus].includes(input.status)) throw new ValidationError(`Invalid workforce transition: ${employee.employmentStatus} to ${input.status}`);
  if (input.status === "TERMINATED" && !input.effectiveDate) throw new ValidationError("A user-entered termination date is required");
  const activeAssignments = await prisma.serviceAssignment.findMany({ where: { organizationId, employeeId, status: "ACTIVE" }, select: { id: true } });
  const result = await prisma.$transaction(async tx => {
    const updated = await tx.employee.update({ where: { id: employee.id }, data: { employmentStatus: input.status, ...(input.status === "TERMINATED" ? { terminationDate: input.effectiveDate } : input.status === "ACTIVE" && employee.employmentStatus === "TERMINATED" ? { terminationDate: null } : {}) } });
    if (employee.userId) await tx.organizationMembership.updateMany({ where: { organizationId, userId: employee.userId }, data: input.status === "ACTIVE" ? { status: "ACTIVE", endedAt: null } : input.status === "TERMINATED" ? { status: "ENDED", endedAt: input.effectiveDate } : { status: "SUSPENDED" } });
    if (input.status !== "ACTIVE") await tx.employeePortalInvitation.updateMany({ where: { organizationId, employeeId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    for (const assignment of activeAssignments) {
      const previous = await tx.serviceAssignmentEligibilityEvaluation.findFirst({ where: { assignmentId: assignment.id }, orderBy: { evaluatedAt: "desc" } });
      const evaluatedAt = new Date(), resultSnapshot = { eligible: false, decision: "BLOCKED", evaluatedAt: evaluatedAt.toISOString(), employeeId, organizationId, reasonCodes: ["EMPLOYEE_INACTIVE"], hardNonOverridable: true, source: "WORKFORCE_LIFECYCLE" };
      const evaluation = await tx.serviceAssignmentEligibilityEvaluation.create({ data: { organizationId, employeeId, assignmentId: assignment.id, actorUserId: user.id, trigger: "REEVALUATION", decision: "BLOCKED", evaluatedAt, engineVersion: "phase10-v1", inputSnapshot: { workforceStatus: input.status }, resultSnapshot, previousEvaluationId: previous?.id } });
      await tx.serviceAssignment.update({ where: { id: assignment.id }, data: { status: "BLOCKED" } });
      await tx.serviceAssignmentEvent.create({ data: { organizationId, assignmentId: assignment.id, actorUserId: user.id, action: "assignment.eligibility_changed", metadata: { evaluationId: evaluation.id, priorDecision: previous?.decision, decision: "BLOCKED", reasonCodes: ["EMPLOYEE_INACTIVE"], source: "WORKFORCE_LIFECYCLE" } } });
    }
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId, eventType: "employee.lifecycle_changed", entityType: "Employee", entityId: employeeId, metadataJson: { from: employee.employmentStatus, to: input.status, effectiveDate: input.effectiveDate?.toISOString() ?? null, administrativeReason: input.reason, assignmentsBlocked: activeAssignments.length } } });
    return updated;
  });
  return { employee: result, changed: true, assignmentsBlocked: activeAssignments.length };
}

export async function correctEmployeeAdministration(user: Pick<User, "id">, organizationId: string, employeeId: string, raw: unknown) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage"), { reason, ...changes } = correctionSchema.parse(raw);
  const duplicates = await findPotentialEmployeeDuplicates(user, organizationId, { employeeNumber: changes.employeeNumber, email: changes.email, firstName: changes.firstName ?? employee.firstName, lastName: changes.lastName ?? employee.lastName, hireDate: changes.hireDate }, employeeId);
  if (duplicates.exactConflicts.length) throw new ValidationError("Employee number or email conflicts with an existing workforce record", duplicates);
  const changedFields = Object.keys(changes).filter(key => changes[key as keyof typeof changes] !== undefined && String(changes[key as keyof typeof changes] ?? "") !== String(employee[key as keyof typeof employee] ?? ""));
  if (!changedFields.length) return { employee, changedFields, potentialDuplicates: duplicates.potentialDuplicates };
  const updated = await prisma.employee.update({ where: { id: employee.id }, data: changes });
  await audit(organizationId, user.id, employeeId, "employee.administrative_corrected", "Employee", employeeId, { changedFields, administrativeReason: reason, potentialDuplicateCount: duplicates.potentialDuplicates.length });
  return { employee: updated, changedFields, potentialDuplicates: duplicates.potentialDuplicates };
}

export async function revokeEmployeeInvitation(user: Pick<User, "id">, organizationId: string, employeeId: string, invitationId: string, reason: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage"); const explanation = z.string().trim().min(3).max(1000).parse(reason);
  const invitation = await prisma.employeePortalInvitation.findFirst({ where: { id: invitationId, organizationId, employeeId } }); if (!invitation) throw new ResourceNotFoundError("Portal invitation not found"); if (invitation.status !== "PENDING") throw new ValidationError("Only pending invitations can be revoked");
  const updated = await prisma.employeePortalInvitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await audit(organizationId, user.id, employeeId, "employee.portal_invitation_revoked", "EmployeePortalInvitation", invitation.id, { administrativeReason: explanation }); return updated;
}

export async function setEmployeeOrganizationAccess(user: Pick<User, "id">, organizationId: string, employeeId: string, enabled: boolean, reason: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.manage"); const explanation = z.string().trim().min(3).max(1000).parse(reason), employee = await prisma.employee.findFirstOrThrow({ where: { id: employeeId, organizationId } });
  if (!employee.userId) throw new ValidationError("Employee is not linked to an account"); if (enabled && employee.employmentStatus !== "ACTIVE") throw new ValidationError("Only an active employee can have organizational portal access restored");
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: employee.userId } } }); if (!membership) throw new ResourceNotFoundError("Organization account access not found");
  const updated = await prisma.organizationMembership.update({ where: { id: membership.id }, data: enabled ? { status: "ACTIVE", endedAt: null } : { status: "SUSPENDED" } });
  await audit(organizationId, user.id, employeeId, enabled ? "employee.portal_access_restored" : "employee.portal_access_disabled", "OrganizationMembership", membership.id, { administrativeReason: explanation }); return updated;
}

export async function listAssignableOrganizationRoles(user: Pick<User, "id">, organizationId: string) {
  const membership = await authorize(user, organizationId, "organization.manage"), actorPermissions = await resolvePermissionCodes(membership.id);
  const roles = await prisma.roleDefinition.findMany({ where: { OR: [{ organizationId }, { organizationId: null, isPlatformStandard: true }], code: { in: [...safeAssignableRoles] } }, include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } });
  return roles.filter(role => role.permissions.every(item => actorPermissions.has(item.permission.code))).map(role => ({ id: role.id, code: role.code, name: role.name, description: role.description, permissions: role.permissions.map(item => item.permission.code).sort() }));
}

export async function mutateOrganizationRole(user: Pick<User, "id">, organizationId: string, employeeId: string, roleDefinitionId: string, action: "GRANT" | "REVOKE") {
  const actorMembership = await authorize(user, organizationId, "organization.manage"), employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { user: true } }); if (!employee) throw new ResourceNotFoundError("Employee not found"); if (!employee.userId) throw new ValidationError("Employee must claim portal access before organization roles can be managed"); if (employee.userId === user.id) throw new AuthorizationError("Self-service role changes are not permitted");
  const target = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: employee.userId } } }); if (!target) throw new ResourceNotFoundError("Organization membership not found");
  const role = await prisma.roleDefinition.findFirst({ where: { id: roleDefinitionId, OR: [{ organizationId }, { organizationId: null, isPlatformStandard: true }] }, include: { permissions: { include: { permission: true } } } }); if (!role) throw new ResourceNotFoundError("Role not found"); if (!safeAssignableRoles.has(role.code) || ["clinical.review", "medication.approve"].some(code => role.permissions.some(item => item.permission.code === code))) throw new AuthorizationError("This role is not assignable through ordinary workforce administration");
  const actorPermissions = await resolvePermissionCodes(actorMembership.id); if (!role.permissions.every(item => actorPermissions.has(item.permission.code))) throw new AuthorizationError("Cannot grant a role containing permissions the actor does not hold");
  if (action === "GRANT") await prisma.membershipRole.upsert({ where: { membershipId_roleDefinitionId: { membershipId: target.id, roleDefinitionId: role.id } }, create: { membershipId: target.id, roleDefinitionId: role.id }, update: {} }); else await prisma.membershipRole.deleteMany({ where: { membershipId: target.id, roleDefinitionId: role.id } });
  await audit(organizationId, user.id, employeeId, action === "GRANT" ? "employee.organization_role_granted" : "employee.organization_role_revoked", "OrganizationMembership", target.id, { roleCode: role.code }); return { employeeId, membershipId: target.id, role: { id: role.id, code: role.code, name: role.name }, action };
}
