import { createHash, randomBytes } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { configuredEmailProviderForPurpose, EmailDeliveryError, type EmailProvider } from "@/domain/notifications/email";
import { assertRoleAssignableToOrganization, isOrganizationOwnerRole, requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const invitationDays = 7;
const protectedOwnerCode = "ORGANIZATION_OWNER";

export const permissionCatalog = [
  ["user.read", "View users"], ["user.invite", "Invite users"], ["user.manage", "Manage roles and membership"], ["permission.manage", "Manage permissions"],
  ["employee.read", "View employee records"], ["employee.manage", "Manage employee records"], ["employee.self.read", "View own employee profile"],
  ["client.read", "View organization clients"], ["client.update", "Manage organization clients"], ["client.assigned.read", "View assigned clients"], ["client.caregiver.read", "View approved caregiver information"],
  ["client.document.read", "View authorized client documents"], ["client.document.generate", "Generate client documents"],
  ["medication.assigned.read", "View assigned-client medication instructions"], ["medication.activity.record", "Record authorized medication activity"], ["medication.approve", "Manage medication approvals"],
  ["billing.view", "View billing"], ["billing.initiate", "Initiate supported billing"], ["billing.mapping.manage", "Manage billing mappings"], ["billing.sync.manage", "Manage synchronization"],
  ["report.read", "View permitted reports"], ["report.export", "Export permitted reports"],
] as const;
const manageableCodes = new Set<string>(permissionCatalog.map(([code]) => code));

export async function inspectOrganizationInvitation(token: string) {
  const invitation = await prisma.organizationUserInvitation.findUnique({ where: { tokenHash: hash(token) }, select: { status: true, expiresAt: true } });
  if (!invitation) return { state: "INVALID" as const };
  if (invitation.status === "ACCEPTED") return { state: "CLAIMED" as const };
  if (invitation.status === "REVOKED") return { state: "REVOKED" as const };
  if (invitation.expiresAt <= new Date()) return { state: "EXPIRED" as const };
  return { state: "VALID" as const };
}

const inviteInput = z.object({
  displayName: z.string().trim().min(2).max(120), email: z.string().email(), roleDefinitionId: z.string().min(1),
  permissionCodes: z.array(z.string()).max(50).default([]), employeeId: z.string().min(1).optional(),
}).strict();

async function managementContext(user: Pick<User, "id">, organizationId: string, permission: "user.read" | "user.invite" | "user.manage" | "permission.manage") {
  const { organization, membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
  return { organization, membership, permissions: await resolvePermissionCodes(membership.id) };
}

async function roleForGrant(organizationId: string, roleDefinitionId: string, actorPermissions: Set<string>) {
  const role = await prisma.roleDefinition.findFirst({ where: { id: roleDefinitionId, OR: [{ organizationId }, { organizationId: null, isPlatformStandard: true }] }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw new ResourceNotFoundError("Role not found");
  assertRoleAssignableToOrganization(role, organizationId);
  if (!role.permissions.every(item => actorPermissions.has(item.permission.code))) throw new AuthorizationError("Cannot grant a role containing permissions you do not hold");
  return role;
}

async function ensureGrantable(actorPermissions: Set<string>, permissionCodes: string[]) {
  const codes = [...new Set(permissionCodes)];
  if (codes.some(code => !manageableCodes.has(code) || !actorPermissions.has(code))) throw new AuthorizationError("Cannot grant a permission you do not hold");
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
  if (permissions.length !== codes.length) throw new ValidationError("One or more permissions are unavailable");
  return permissions;
}

export async function listOrganizationUsers(user: Pick<User, "id">, organizationId: string) {
  const { permissions } = await managementContext(user, organizationId, "user.read");
  const [memberships, invitations, roles] = await Promise.all([
    prisma.organizationMembership.findMany({ where: { organizationId }, include: { user: { select: { id: true, email: true, status: true, lastLoginAt: true, employees: { where: { organizationId }, select: { id: true, firstName: true, lastName: true } } } }, roles: { include: { roleDefinition: { include: { permissions: { include: { permission: true } } } } } }, permissionOverrides: { include: { permission: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.organizationUserInvitation.findMany({ where: { organizationId, status: "PENDING" }, include: { roleDefinition: { select: { id: true, name: true, code: true } }, employee: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { invitedAt: "desc" } }),
    prisma.roleDefinition.findMany({ where: { OR: [{ organizationId }, { organizationId: null, isPlatformStandard: true }] }, include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } }),
  ]);
  return {
    capabilities: { canInvite: permissions.has("user.invite"), canManage: permissions.has("user.manage"), canManagePermissions: permissions.has("permission.manage") },
    permissionCatalog: permissionCatalog.filter(([code]) => permissions.has(code)).map(([code, label]) => ({ code, label })),
    roles: roles.filter(role => role.permissions.every(item => permissions.has(item.permission.code))).map(role => ({ id: role.id, code: role.code, name: role.name, description: role.description, permissionCodes: role.permissions.map(item => item.permission.code).sort() })),
    users: await Promise.all(memberships.map(async membership => ({
      id: membership.id, userId: membership.userId, email: membership.user.email, status: membership.status, accountStatus: membership.user.status,
      lastSignInAt: membership.user.lastLoginAt?.toISOString() ?? null, employee: membership.user.employees[0] ?? null,
      roles: membership.roles.map(item => ({ id: item.roleDefinition.id, code: item.roleDefinition.code, name: item.roleDefinition.name })),
      overrides: membership.permissionOverrides.map(item => ({ code: item.permission.code, effect: item.effect })),
      effectivePermissions: [...await resolvePermissionCodes(membership.id)].sort(),
    }))),
    invitations: invitations.map(invitation => ({ id: invitation.id, displayName: invitation.displayName, email: invitation.invitedEmail, status: invitation.status, invitedAt: invitation.invitedAt.toISOString(), expiresAt: invitation.expiresAt.toISOString(), role: invitation.roleDefinition, employee: invitation.employee })),
  };
}

export async function inviteOrganizationUser(user: Pick<User, "id">, organizationId: string, raw: unknown, provider: EmailProvider = configuredEmailProviderForPurpose("WORKFORCE_TRANSACTIONAL")) {
  const input = inviteInput.parse(raw), { organization, membership, permissions: actorPermissions } = await managementContext(user, organizationId, "user.invite");
  await requirePermission(membership.id, "user.manage");
  const role = await roleForGrant(organizationId, input.roleDefinitionId, actorPermissions), grants = await ensureGrantable(actorPermissions, input.permissionCodes), email = normalizeEmail(input.email);
  const [existingPending, employee] = await Promise.all([
    prisma.organizationUserInvitation.findFirst({ where: { organizationId, invitedEmail: email, status: "PENDING", expiresAt: { gt: new Date() } } }),
    input.employeeId ? prisma.employee.findFirst({ where: { id: input.employeeId, organizationId }, select: { id: true, userId: true, email: true } }) : null,
  ]);
  if (existingPending) throw new ConflictError("A pending invitation already exists for this email", "INVITATION_ALREADY_PENDING");
  if (input.employeeId && !employee) throw new ResourceNotFoundError("Employee not found");
  if (employee?.userId) throw new ConflictError("Employee already has portal access", "EMPLOYEE_ALREADY_LINKED");
  if (employee?.email && normalizeEmail(employee.email) !== email) throw new ValidationError("Invitation email must match the linked employee email");
  const account = await prisma.user.findUnique({ where: { email } });
  if (account && await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: account.id } } })) throw new ConflictError("This user already belongs to the organization", "MEMBERSHIP_EXISTS");
  const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + invitationDays * 86_400_000);
  const invitation = await prisma.$transaction(async tx => {
    const created = await tx.organizationUserInvitation.create({ data: { organizationId, invitedEmail: email, displayName: input.displayName, tokenHash: hash(token), expiresAt, roleDefinitionId: role.id, permissionCodes: grants.map(item => item.code), employeeId: employee?.id, invitedByUserId: user.id } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.user_invited", entityType: "OrganizationUserInvitation", entityId: created.id, metadataJson: { roleCode: role.code, permissionCodes: grants.map(item => item.code), employeeLinked: Boolean(employee) } } });
    return created;
  });
  try {
    if (!provider.configured || provider.name.includes("paubox")) throw new EmailDeliveryError("Organization invitation delivery is unavailable", false, "ORGANIZATION_INVITATION_PROVIDER_UNAVAILABLE");
    const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""), claimUrl = `${base}/learn/claim/${encodeURIComponent(token)}`;
    await provider.send({ to: email, subject: `You're invited to ${organization.displayName}`, text: `${input.displayName},\n\nYou have been invited to ${organization.displayName}. Accept the invitation: ${claimUrl}\n\nThis invitation expires in ${invitationDays} days.`, actionHref: claimUrl, deliveryContext: { organizationId, logicalType: "OrganizationUserInvitation", logicalId: invitation.id, purpose: "WORKFORCE_TRANSACTIONAL" } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.user_invitation_provider_accepted", entityType: "OrganizationUserInvitation", entityId: invitation.id, metadataJson: { provider: provider.name } } });
  } catch (error) {
    const code = error instanceof EmailDeliveryError ? error.code : "ORGANIZATION_INVITATION_DELIVERY_FAILED";
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.user_invitation_delivery_failed", entityType: "OrganizationUserInvitation", entityId: invitation.id, metadataJson: { errorCode: code } } });
  }
  return { invitation: { id: invitation.id, email, expiresAt, status: invitation.status }, ...(process.env.NODE_ENV === "production" ? {} : { claimToken: token }) };
}

export async function cancelOrganizationInvitation(user: Pick<User, "id">, organizationId: string, invitationId: string) {
  await managementContext(user, organizationId, "user.invite");
  const changed = await prisma.organizationUserInvitation.updateMany({ where: { id: invitationId, organizationId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
  if (!changed.count) throw new ResourceNotFoundError("Pending invitation not found");
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.user_invitation_revoked", entityType: "OrganizationUserInvitation", entityId: invitationId } });
  return { id: invitationId, status: "REVOKED" as const };
}

export async function reissueOrganizationInvitation(user: Pick<User, "id">, organizationId: string, invitationId: string, provider?: EmailProvider) {
  await managementContext(user, organizationId, "user.invite");
  const previous = await prisma.organizationUserInvitation.findFirst({ where: { id: invitationId, organizationId, status: "PENDING" } });
  if (!previous?.roleDefinitionId) throw new ResourceNotFoundError("Pending invitation not found");
  await cancelOrganizationInvitation(user, organizationId, invitationId);
  const result = await inviteOrganizationUser(user, organizationId, { displayName: previous.displayName ?? previous.invitedEmail, email: previous.invitedEmail, roleDefinitionId: previous.roleDefinitionId, permissionCodes: Array.isArray(previous.permissionCodes) ? previous.permissionCodes : [], employeeId: previous.employeeId ?? undefined }, provider);
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.user_invitation_reissued", entityType: "OrganizationUserInvitation", entityId: result.invitation.id, metadataJson: { replacedInvitationId: invitationId } } });
  return result;
}

async function ownerCount(organizationId: string) {
  return prisma.organizationMembership.count({ where: { organizationId, status: "ACTIVE", roles: { some: { roleDefinition: { code: protectedOwnerCode, OR: [{ organizationId }, { organizationId: null, isPlatformStandard: true }] } } } } });
}

export async function updateOrganizationMembership(user: Pick<User, "id">, organizationId: string, membershipId: string, raw: unknown) {
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("SET_STATUS"), status: z.enum(["ACTIVE", "SUSPENDED"]) }).strict(),
    z.object({ action: z.literal("SET_ROLE"), roleDefinitionId: z.string().min(1) }).strict(),
    z.object({ action: z.literal("SET_PERMISSION"), permissionCode: z.string(), effect: z.enum(["GRANT", "DENY", "INHERIT"]) }).strict(),
  ]).parse(raw);
  const { membership: actor, permissions: actorPermissions } = await managementContext(user, organizationId, input.action === "SET_PERMISSION" ? "permission.manage" : "user.manage");
  const target = await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId }, include: { roles: { include: { roleDefinition: true } } } });
  if (!target) throw new ResourceNotFoundError("Organization user not found");
  const targetIsOwner = target.roles.some(item => isOrganizationOwnerRole(item.roleDefinition, organizationId));
  if (input.action === "SET_STATUS") {
    if (target.userId === user.id && input.status !== "ACTIVE") throw new AuthorizationError("You cannot deactivate your own organization access");
    if (targetIsOwner && input.status !== "ACTIVE" && await ownerCount(organizationId) <= 1) throw new ConflictError("The last active owner cannot be deactivated", "LAST_OWNER_REQUIRED");
    await prisma.organizationMembership.update({ where: { id: target.id }, data: input.status === "ACTIVE" ? { status: "ACTIVE", joinedAt: target.joinedAt ?? new Date(), endedAt: null } : { status: "SUSPENDED" } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: input.status === "ACTIVE" ? "organization.membership_reactivated" : "organization.membership_deactivated", entityType: "OrganizationMembership", entityId: target.id, metadataJson: { before: target.status, after: input.status, targetUserId: target.userId } } });
  } else if (input.action === "SET_ROLE") {
    if (target.userId === user.id && actor.id === target.id) throw new AuthorizationError("Self-service role changes are not permitted");
    const role = await roleForGrant(organizationId, input.roleDefinitionId, actorPermissions), nextIsOwner = isOrganizationOwnerRole(role, organizationId);
    if (targetIsOwner && !nextIsOwner && await ownerCount(organizationId) <= 1) throw new ConflictError("The last active owner cannot be removed", "LAST_OWNER_REQUIRED");
    await prisma.$transaction(async tx => { await tx.membershipRole.deleteMany({ where: { membershipId: target.id } }); await tx.membershipRole.create({ data: { membershipId: target.id, roleDefinitionId: role.id } }); await tx.membershipPermission.deleteMany({ where: { membershipId: target.id } }); await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.membership_role_changed", entityType: "OrganizationMembership", entityId: target.id, metadataJson: { before: target.roles.map(item => item.roleDefinition.code), after: [role.code], targetUserId: target.userId } } }); });
  } else {
    if (target.userId === user.id) throw new AuthorizationError("Self-service permission changes are not permitted");
    if (targetIsOwner) throw new AuthorizationError("Owner permissions are managed through the protected owner role");
    const [permission] = await ensureGrantable(actorPermissions, [input.permissionCode]);
    const before = await prisma.membershipPermission.findUnique({ where: { membershipId_permissionId: { membershipId: target.id, permissionId: permission.id } } });
    if (input.effect === "INHERIT") await prisma.membershipPermission.deleteMany({ where: { membershipId: target.id, permissionId: permission.id } });
    else await prisma.membershipPermission.upsert({ where: { membershipId_permissionId: { membershipId: target.id, permissionId: permission.id } }, create: { membershipId: target.id, permissionId: permission.id, effect: input.effect, grantedByUserId: user.id }, update: { effect: input.effect, grantedByUserId: user.id } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "organization.membership_permission_changed", entityType: "OrganizationMembership", entityId: target.id, metadataJson: { permissionCode: permission.code, before: before?.effect ?? "INHERIT", after: input.effect, targetUserId: target.userId } } });
  }
  return { membershipId: target.id, effectivePermissions: [...await resolvePermissionCodes(target.id)].sort() };
}

export async function claimOrganizationInvitation(identity: { subject: string; email: string; emailVerified: true }, token: string) {
  const tokenHash = hash(token), invitation = await prisma.organizationUserInvitation.findUnique({ where: { tokenHash }, include: { roleDefinition: { include: { permissions: { include: { permission: true } } } }, invitedBy: true, employee: true } });
  if (!invitation?.roleDefinition || invitation.status !== "PENDING") throw new ResourceNotFoundError("Invitation is invalid or unavailable");
  if (invitation.expiresAt <= new Date()) throw new ConflictError("This invitation has expired", "INVITATION_EXPIRED");
  if (normalizeEmail(identity.email) !== invitation.invitedEmail) throw new ConflictError("This invitation was sent to a different account", "INVITATION_ACCOUNT_MISMATCH");
  const roleDefinition = invitation.roleDefinition;
  const inviterMembership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: invitation.organizationId, userId: invitation.invitedByUserId } } });
  if (!inviterMembership || inviterMembership.status !== "ACTIVE") throw new AuthorizationError("The invitation is no longer authorized");
  const inviterPermissions = await resolvePermissionCodes(inviterMembership.id), requested = Array.isArray(invitation.permissionCodes) ? invitation.permissionCodes.filter((value): value is string => typeof value === "string") : [];
  if (!roleDefinition.permissions.every(item => inviterPermissions.has(item.permission.code)) || requested.some(code => !inviterPermissions.has(code))) throw new AuthorizationError("The invitation exceeds the inviter's current authority");
  return prisma.$transaction(async tx => {
    const [bySubject, byEmail] = await Promise.all([tx.user.findUnique({ where: { authProviderUserId: identity.subject } }), tx.user.findUnique({ where: { email: invitation.invitedEmail } })]);
    if (bySubject && byEmail && bySubject.id !== byEmail.id) throw new ConflictError("This invitation was sent to a different account", "INVITATION_ACCOUNT_MISMATCH");
    const account = bySubject ?? byEmail ?? await tx.user.create({ data: { email: invitation.invitedEmail, authProviderUserId: identity.subject, status: "ACTIVE" } });
    if (account.authProviderUserId && account.authProviderUserId !== identity.subject) throw new ConflictError("This invitation was sent to a different account", "INVITATION_ACCOUNT_MISMATCH");
    await tx.user.update({ where: { id: account.id }, data: { authProviderUserId: identity.subject, status: "ACTIVE" } });
    const membership = await tx.organizationMembership.upsert({ where: { organizationId_userId: { organizationId: invitation.organizationId, userId: account.id } }, create: { organizationId: invitation.organizationId, userId: account.id, status: "ACTIVE", joinedAt: new Date() }, update: { status: "ACTIVE", joinedAt: new Date(), endedAt: null } });
    await tx.membershipRole.upsert({ where: { membershipId_roleDefinitionId: { membershipId: membership.id, roleDefinitionId: invitation.roleDefinitionId! } }, create: { membershipId: membership.id, roleDefinitionId: invitation.roleDefinitionId! }, update: {} });
    const permissions = await tx.permission.findMany({ where: { code: { in: requested } } });
    for (const permission of permissions) await tx.membershipPermission.upsert({ where: { membershipId_permissionId: { membershipId: membership.id, permissionId: permission.id } }, create: { membershipId: membership.id, permissionId: permission.id, effect: "GRANT", grantedByUserId: invitation.invitedByUserId }, update: { effect: "GRANT", grantedByUserId: invitation.invitedByUserId } });
    if (invitation.employee) { if (invitation.employee.userId && invitation.employee.userId !== account.id) throw new ConflictError("Employee is already linked", "EMPLOYEE_ALREADY_LINKED"); await tx.employee.update({ where: { id: invitation.employee.id }, data: { userId: account.id } }); }
    const accepted = await tx.organizationUserInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: account.id } });
    if (accepted.count !== 1) throw new ConflictError("Invitation has already been claimed", "INVITATION_ALREADY_CLAIMED");
    await tx.auditEvent.create({ data: { organizationId: invitation.organizationId, actorUserId: account.id, eventType: "organization.user_invitation_claimed", entityType: "OrganizationUserInvitation", entityId: invitation.id, metadataJson: { roleCode: roleDefinition.code, permissionCodes: requested, employeeLinked: Boolean(invitation.employee) } } });
    return { organizationId: invitation.organizationId, membershipId: membership.id, destination: `/admin/home?organizationId=${encodeURIComponent(invitation.organizationId)}` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
