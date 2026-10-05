import { createHash, randomBytes } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { computeEmployeeOperationalProfile } from "@/domain/compliance/operations/service";
import { requireEmployeeAccess, requireEmployeeSelfAccess, requireOrganizationAccess, requireOrganizationMembership, requirePermission } from "@/domain/permissions/authorization";
import { deriveAssignmentDisplayStatus } from "@/domain/training/assignments/service";
import { configuredEmailProviderForPurpose, EmailDeliveryError, type EmailProvider } from "@/domain/notifications/email";
import { prisma } from "@/lib/prisma";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function inviteEmployeeToPortal(user: Pick<User, "id">, organizationId: string, employeeId: string, provider: EmailProvider = configuredEmailProviderForPurpose("WORKFORCE_TRANSACTIONAL")) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "employee.manage");
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { organization: { select: { displayName: true } } } });
  if (!employee?.email) throw new AuthorizationError("Employee email is required before portal access can be enabled");
  if (["LEAVE", "TERMINATED", "ARCHIVED"].includes(employee.employmentStatus)) throw new AuthorizationError("Inactive or separated employees cannot be invited to portal access");
  const invitedEmail = employee.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email: invitedEmail } });
  const account = existingUser ?? await prisma.user.create({ data: { email: invitedEmail, status: "INVITED" } });
  if (employee.userId && employee.userId !== account.id) throw new AuthorizationError("Employee is already linked to another account");
  const existingEmployee = await prisma.employee.findFirst({ where: { organizationId, userId: account.id, id: { not: employeeId } } });
  if (existingEmployee) throw new AuthorizationError("Account is already linked to another employee in this organization");
  await prisma.organizationMembership.upsert({ where: { organizationId_userId: { organizationId, userId: account.id } }, create: { organizationId, userId: account.id, status: "INVITED" }, update: {} });
  const token = randomBytes(32).toString("base64url");
  const invitation = await prisma.$transaction(async tx => {
    await tx.employeePortalInvitation.updateMany({ where: { organizationId, employeeId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    const created = await tx.employeePortalInvitation.create({ data: { organizationId, employeeId, invitedEmail, tokenHash: hashToken(token), invitedByUserId: user.id } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId, eventType: "employee.portal_invited", entityType: "EmployeePortalInvitation", entityId: created.id, metadataJson: { invitedEmail } } });
    return created;
  });
  const attemptedAt = new Date();
  let delivered;
  try {
    if (!provider.configured) throw new EmailDeliveryError("Workforce transactional email is not configured", false, "WORKFORCE_EMAIL_PROVIDER_NOT_CONFIGURED");
    if (provider.name === "paubox" || provider.name.includes("paubox")) throw new EmailDeliveryError("Paubox is prohibited for workforce transactional email", false, "WORKFORCE_EMAIL_PROVIDER_POLICY_VIOLATION");
    const baseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""), claimUrl = `${baseUrl}/learn/claim/${encodeURIComponent(token)}`;
    const accepted = await provider.send({
      to: invitedEmail,
      subject: `You're invited to ${employee.organization.displayName}`,
      text: `${employee.organization.displayName} invited you to access your Compliance Platform employee account.\n\nAccept your invitation: ${claimUrl}\n\nThis invitation expires seven days after it was created. If you did not expect this invitation, contact your organization administrator.`,
      actionHref: claimUrl,
      deliveryContext: { organizationId, logicalType: "EmployeePortalInvitation", logicalId: invitation.id, purpose: "WORKFORCE_TRANSACTIONAL" },
    });
    const selectedProvider=accepted.provider??provider.name;
    delivered = await prisma.employeePortalInvitation.update({ where: { id: invitation.id }, data: { deliveryStatus: "ACCEPTED", deliveryAttempts: { increment: 1 }, deliveryAttemptedAt: attemptedAt, deliveryProvider: selectedProvider, providerMessageId: accepted.messageId, providerAcceptedAt: accepted.acceptedAt ?? attemptedAt, deliveryErrorCode: null } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId, eventType: "employee.portal_invitation_provider_accepted", entityType: "EmployeePortalInvitation", entityId: invitation.id, metadataJson: { provider: selectedProvider } } });
  } catch (error) {
    const failure = error instanceof EmailDeliveryError ? error : new EmailDeliveryError("Workforce invitation delivery failed", true);
    delivered = await prisma.employeePortalInvitation.update({ where: { id: invitation.id }, data: { deliveryStatus: "FAILED", deliveryAttempts: { increment: 1 }, deliveryAttemptedAt: attemptedAt, deliveryProvider: provider.name, deliveryErrorCode: failure.code } });
    await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId, eventType: "employee.portal_invitation_delivery_failed", entityType: "EmployeePortalInvitation", entityId: invitation.id, metadataJson: { provider: provider.name, errorCode: failure.code, retryable: failure.retryable } } });
  }
  return { invitation: { id: delivered.id, employeeId, invitedEmail, invitedUserId: account.id, status: delivered.status, deliveryStatus: delivered.deliveryStatus, deliveryAttempts: delivered.deliveryAttempts, deliveryAttemptedAt: delivered.deliveryAttemptedAt, deliveryProvider: delivered.deliveryProvider, providerAcceptedAt: delivered.providerAcceptedAt, deliveryErrorCode: delivered.deliveryErrorCode, invitedAt: delivered.invitedAt, acceptedAt: delivered.acceptedAt }, claimToken: token };
}

export async function claimEmployeePortalInvitationByToken(user: Pick<User, "id" | "email">, token: string) {
  const invitation = await prisma.employeePortalInvitation.findUnique({ where: { tokenHash: hashToken(token) }, select: { organizationId: true } });
  if (!invitation) throw new ResourceNotFoundError("Portal invitation not found");
  return claimEmployeePortalInvitation(user, invitation.organizationId, token);
}

export async function claimEmployeePortalInvitation(user: Pick<User, "id" | "email">, organizationId: string, token: string) {
  if (!user.email) throw new AuthorizationError("Authenticated account must have an email address");
  const invitation = await prisma.employeePortalInvitation.findFirst({ where: { organizationId, tokenHash: hashToken(token), status: "PENDING" }, include: { employee: true } });
  if (!invitation) throw new ResourceNotFoundError("Portal invitation not found");
  if (invitation.invitedAt < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) throw new AuthorizationError("Portal invitation expired");
  if (!["PENDING", "ACTIVE"].includes(invitation.employee.employmentStatus)) throw new AuthorizationError("Inactive or separated employees cannot claim portal access");
  if (invitation.invitedEmail.toLowerCase() !== user.email.toLowerCase()) throw new AuthorizationError("Invitation belongs to a different account");
  const conflicting = await prisma.employee.findFirst({ where: { organizationId, userId: user.id, id: { not: invitation.employeeId } } });
  if (conflicting || invitation.employee.userId && invitation.employee.userId !== user.id) throw new AuthorizationError("Account cannot claim this employee profile");
  return prisma.$transaction(async tx => {
    await tx.employee.update({ where: { id: invitation.employeeId }, data: { userId: user.id } });
    await tx.organizationMembership.upsert({ where: { organizationId_userId: { organizationId, userId: user.id } }, create: { organizationId, userId: user.id, status: "ACTIVE", joinedAt: new Date() }, update: { status: "ACTIVE", joinedAt: new Date(), endedAt: null } });
    const accepted = await tx.employeePortalInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedByUserId: user.id, acceptedAt: new Date() } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: invitation.employeeId, eventType: "employee.portal_invitation_claimed", entityType: "EmployeePortalInvitation", entityId: invitation.id } });
    return { invitationId: accepted.id, employeeId: invitation.employeeId, status: accepted.status };
  });
}

export async function getEmployeePortalAccess(user: Pick<User, "id">, organizationId: string, employeeId: string) {
  await requireEmployeeAccess(user, organizationId, employeeId, "employee.read");
  const employee = await prisma.employee.findFirstOrThrow({ where: { id: employeeId, organizationId }, select: { id: true, userId: true, email: true } });
  const invitation = await prisma.employeePortalInvitation.findFirst({ where: { organizationId, employeeId }, orderBy: { invitedAt: "desc" }, select: { id: true, invitedEmail: true, status: true, deliveryStatus: true, deliveryAttempts: true, deliveryAttemptedAt: true, deliveryProvider: true, providerAcceptedAt: true, deliveryErrorCode: true, invitedAt: true, acceptedAt: true, revokedAt: true } });
  return { employee, invitation, enabled: Boolean(employee.userId && invitation?.status === "ACCEPTED") };
}

async function resolveSelf(user: Pick<User, "id">, organizationId: string) {
  await requireOrganizationMembership(user.id, organizationId);
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId: user.id, employmentStatus: { in: ["PENDING", "ACTIVE"] } } });
  if (!employee) throw new AuthorizationError("Employee self-access denied");
  await requireEmployeeSelfAccess(user, organizationId, employee.id);
  return employee;
}

function actionOwner(stepType: string) {
  if (["TRAINING", "POLICY_ACKNOWLEDGMENT", "EMPLOYEE_INFORMATION"].includes(stepType)) return "EMPLOYEE" as const;
  if (stepType === "COMPETENCY") return "ASSESSOR" as const;
  if (stepType === "CREDENTIAL") return "ORGANIZATION" as const;
  if (stepType === "MANUAL_ADMIN_CHECK" || stepType === "EMPLOYMENT_EVENT") return "ORGANIZATION" as const;
  return "ORGANIZATION" as const;
}

const employeeIssueTypes = new Set(["TRAINING_REQUIRED", "TRAINING_OVERDUE", "POLICY_ACKNOWLEDGMENT_REQUIRED"]);

export async function getEmployeePortal(user: Pick<User, "id">, organizationId: string) {
  const employee = await resolveSelf(user, organizationId);
  const [onboardings, assignments, policies, issues, certificates, profile, qualifications, instructions, authorizations, invitation] = await Promise.all([
    prisma.employeeOnboarding.findMany({ where: { organizationId, employeeId: employee.id }, include: { templateVersion: { include: { onboardingTemplate: true } }, steps: { include: { stepDefinition: true }, orderBy: { stepDefinition: { sequence: "asc" } } } } }),
    prisma.trainingAssignment.findMany({ where: { organizationId, employeeId: employee.id }, include: { courseVersion: { include: { course: true, modules: { select: { id: true, _count: { select: { contentItems: true } } } } } }, completion: true, contentProgress: true, acknowledgments: true, moduleProgress: true }, orderBy: { assignedAt: "desc" } }),
    prisma.policyAssignment.findMany({ where: { organizationId, employeeId: employee.id }, include: { policyVersion: { include: { policy: true } }, attestation: true }, orderBy: { assignedAt: "desc" } }),
    prisma.complianceIssue.findMany({ where: { organizationId, employeeId: employee.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }] }),
    prisma.certificate.findMany({ where: { organizationId, employeeId: employee.id }, select: { id: true, certificateNumber: true, certificateType: true, status: true, issuedAt: true, expiresAt: true, courseVersionId: true, trainingCompletionId: true, certificateSnapshotJson: true }, orderBy: { issuedAt: "desc" } }),
    computeEmployeeOperationalProfile(organizationId, employee.id),
    prisma.medicationQualification.findMany({ where: { organizationId, employeeId: employee.id }, select: { id: true, decision: true, status: true, qualifiedAt: true, validUntil: true, trainingCompletionId: true, competencyAssessmentId: true } }),
    prisma.personSpecificMedicationInstruction.findMany({ where: { organizationId, employeeId: employee.id }, select: { id: true, serviceRecipientRef: true, instructedAt: true, effectiveFrom: true, effectiveUntil: true, status: true } }),
    prisma.medicationAuthorizationEvidence.findMany({ where: { organizationId, employeeId: employee.id }, select: { id: true, serviceRecipientRef: true, authorizationType: true, effectiveFrom: true, effectiveUntil: true, status: true } }),
    prisma.employeePortalInvitation.findFirst({ where: { organizationId, employeeId: employee.id }, orderBy: { invitedAt: "desc" }, select: { status: true, invitedAt: true, acceptedAt: true } }),
  ]);
  const training = assignments.map(assignment => {
    const totalContent = assignment.courseVersion.modules.reduce((total, module) => total + module._count.contentItems, 0);
    return { id: assignment.id, title: assignment.courseVersion.course.title, category: assignment.courseVersion.course.category, courseVersion: assignment.courseVersion.versionNumber, status: assignment.status, displayStatus: deriveAssignmentDisplayStatus(assignment), dueAt: assignment.dueAt, assignedAt: assignment.assignedAt, completedAt: assignment.completion?.completedAt ?? null, progress: { completedContent: assignment.contentProgress.filter(item => item.status === "COMPLETED").length + assignment.acknowledgments.length, totalContent, completedModules: assignment.moduleProgress.filter(item => item.status === "COMPLETED").length, totalModules: assignment.courseVersion.modules.length } };
  });
  return {
    employee: { id: employee.id, employeeNumber: employee.employeeNumber, firstName: employee.firstName, lastName: employee.lastName, preferredName: employee.preferredName, jobTitle: employee.jobTitle, employmentStatus: employee.employmentStatus }, portalAccess: invitation,
    readiness: profile.readiness, overallComplianceStatus: profile.overallStatus,
    onboarding: onboardings.map(onboarding => ({ id: onboarding.id, name: onboarding.templateVersion.onboardingTemplate.name, status: onboarding.status, startedAt: onboarding.startedAt, completedAt: onboarding.completedAt, steps: onboarding.steps.map(step => ({ id: step.id, code: step.stepDefinition.code, name: step.stepDefinition.name, type: step.stepDefinition.stepType, required: step.stepDefinition.required, status: step.status, dueAt: step.dueAt, actionOwner: actionOwner(step.stepDefinition.stepType), message: (step.explanationJson as { message?: string } | null)?.message ?? null })) })),
    training, policies: policies.map(item => ({ id: item.id, status: item.status, assignedAt: item.assignedAt, dueAt: item.dueAt, acknowledgedAt: item.acknowledgedAt, policy: { id: item.policyVersion.policy.id, code: item.policyVersion.policy.code, title: item.policyVersion.policy.title, description: item.policyVersion.policy.description, version: item.policyVersion.versionNumber, body: item.policyVersion.body, contentHash: item.policyVersion.contentHash } })),
    compliance: { requirements: profile.requirements, issues: issues.map(issue => ({ id: issue.id, issueType: issue.issueType, priority: issue.priority, status: issue.status, dueAt: issue.dueAt, reasons: issue.reasonCodesJson, visibility: employeeIssueTypes.has(issue.issueType) ? "EMPLOYEE_ACTION" : "WAITING_ON_ORGANIZATION", permittedActions: employeeIssueTypes.has(issue.issueType) ? issue.remediationActionsJson : [] })) },
    medicationGovernance: { qualifications, personSpecificInstructions: instructions.map(item => ({ ...item, serviceRecipientRef: item.serviceRecipientRef.slice(0, 12) })), administrationAuthorizations: authorizations.map(item => ({ ...item, serviceRecipientRef: item.serviceRecipientRef?.slice(0, 12) ?? null })), disclaimer: "Training completion alone is not medication qualification or administration authorization." },
    certificates,
    nextActions: [...training.filter(item => !["COMPLETED", "TRAINING_COMPLETE_COMPETENCY_PENDING", "CANCELLED", "SUPERSEDED"].includes(item.status)).map(item => ({ type: "TRAINING", resourceId: item.id, label: `Continue ${item.title}`, dueAt: item.dueAt })), ...policies.filter(item => ["PENDING", "OVERDUE"].includes(item.status)).map(item => ({ type: "POLICY", resourceId: item.id, label: `Acknowledge ${item.policyVersion.policy.title}`, dueAt: item.dueAt }))],
  };
}

export async function recordEmployeeAttestation(user: Pick<User, "id">, organizationId: string, input: { resourceType: string; resourceId: string; statementVersion: string; statement: string; typedName: string }) {
  const employee = await resolveSelf(user, organizationId);
  if (!input.resourceType.startsWith("EMPLOYEE_")) throw new AuthorizationError("This resource does not permit employee self-attestation");
  const signedAt = new Date(), canonical = JSON.stringify({ organizationId, signerUserId: user.id, resourceType: input.resourceType, resourceId: input.resourceId, statementVersion: input.statementVersion, statementSnapshot: input.statement, signedAt: signedAt.toISOString() });
  return prisma.$transaction(async tx => {
    const attestation = await tx.attestation.create({ data: { organizationId, attestationType: "EMPLOYEE_COMPLETION", signerUserId: user.id, signerEmployeeId: employee.id, typedName: input.typedName, statementVersion: input.statementVersion, statementSnapshot: input.statement, resourceType: input.resourceType, resourceId: input.resourceId, signedAt, signatureHash: hashToken(canonical) } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: employee.id, eventType: "employee.attestation_submitted", entityType: "Attestation", entityId: attestation.id, metadataJson: { resourceType: input.resourceType, resourceId: input.resourceId } as Prisma.InputJsonValue } });
    return attestation;
  });
}
