import type { TrainingAssignmentStatus, User } from "@prisma/client";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireOrganizationAccess, requireOrganizationOwner, requirePermission } from "@/domain/permissions/authorization";
import { getAssignment, deriveAssignmentDisplayStatus } from "@/domain/training/assignments/service";
import { saveAssessmentDraftResponse, startAttempt, submitAttempt } from "@/domain/training/assessments/service";
import { completeContent } from "@/domain/training/progress/service";
import { prisma } from "@/lib/prisma";

export async function listTrainingOperations(user: Pick<User, "id">, organizationId: string, filters: { employee?: string; employeeId?: string; course?: string; status?: string; attention?: boolean } = {}) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "compliance.operations.read");
  const owner = membership.roles.some(role => role.roleDefinition.code === "ORGANIZATION_OWNER" && role.roleDefinition.isPlatformStandard && role.roleDefinition.organizationId === null);
  const rows = await prisma.trainingAssignment.findMany({
    where: { organizationId, employeeId: filters.employeeId, employee: filters.employee ? { OR: [{ firstName: { contains: filters.employee, mode: "insensitive" } }, { lastName: { contains: filters.employee, mode: "insensitive" } }, { employeeNumber: { contains: filters.employee, mode: "insensitive" } }] } : undefined, courseVersion: filters.course ? { course: { title: { contains: filters.course, mode: "insensitive" } } } : undefined, status: filters.status && filters.status !== "ALL" ? filters.status as TrainingAssignmentStatus : undefined },
    include: { employee: { select: { id: true, firstName: true, lastName: true, preferredName: true, employeeNumber: true } }, courseVersion: { include: { course: true, modules: { include: { contentItems: { select: { id: true, required: true, contentType: true } }, assessments: { where: { status: "PUBLISHED" }, select: { id: true } } } } } }, contentProgress: true, acknowledgments: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 }, completion: true },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }], take: 250,
  });
  const now = new Date();
  const items = rows.map(row => {
    const contents = row.courseVersion.modules.flatMap(module => module.contentItems), completed = new Set(row.contentProgress.filter(progress => progress.status === "COMPLETED").map(progress => progress.contentItemId)), acknowledged = new Set(row.acknowledgments.map(item => item.contentItemId));
    const completedContent = contents.filter(item => item.contentType === "ACKNOWLEDGMENT" ? acknowledged.has(item.id) : completed.has(item.id)).length, totalContent = contents.length, requiredComplete = contents.filter(item => item.required).every(item => item.contentType === "ACKNOWLEDGMENT" ? acknowledged.has(item.id) : completed.has(item.id));
    const latestAttempt = row.attempts[0] ?? null, displayStatus = deriveAssignmentDisplayStatus(row, now), percentage = totalContent ? Math.round(completedContent / totalContent * 100) : row.completion ? 100 : 0;
    return { id: row.id, employee: row.employee, course: { id: row.courseVersion.course.id, code: row.courseVersion.course.code, title: row.courseVersion.course.title }, courseVersion: row.courseVersion.versionNumber, status: row.status, displayStatus, assignedAt: row.assignedAt, dueAt: row.dueAt, completedAt: row.completion?.completedAt ?? null, progress: { completedContent, totalContent, percentage, requiredComplete }, assessment: latestAttempt ? { attemptNumber: latestAttempt.attemptNumber, state: latestAttempt.submittedAt ? latestAttempt.passed ? "PASSED" : "FAILED" : "IN_PROGRESS", submittedAt: latestAttempt.submittedAt } : { attemptNumber: null, state: "NOT_STARTED", submittedAt: null }, attention: displayStatus === "OVERDUE" || row.status === "FAILED" || Boolean(latestAttempt && !latestAttempt.submittedAt) };
  });
  return { canAssist: owner, items: filters.attention ? items.filter(item => item.attention) : items };
}

async function ownerAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string) {
  await requireOrganizationOwner(user, organizationId);
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, organizationId } });
  if (!assignment) throw new ResourceNotFoundError("Training assignment not found");
  return assignment;
}

export async function getOwnerTrainingAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string) {
  const assignment = await ownerAssignment(user, organizationId, assignmentId);
  return getAssignment(organizationId, assignment.employeeId, assignment.id);
}

export async function startOwnerAssessment(user: Pick<User, "id">, organizationId: string, assignmentId: string, assessmentId: string) {
  const assignment = await ownerAssignment(user, organizationId, assignmentId);
  return startAttempt(assignment.id, assignment.employeeId, assessmentId);
}

export async function saveOwnerAssessmentResponse(user: Pick<User, "id">, organizationId: string, assignmentId: string, attemptId: string, input: unknown) {
  const assignment = await ownerAssignment(user, organizationId, assignmentId);
  return saveAssessmentDraftResponse(attemptId, assignment.employeeId, input, { actorUserId: user.id, administrative: true, assignmentId: assignment.id });
}

export async function advanceOwnerContent(user: Pick<User, "id">, organizationId: string, assignmentId: string, contentItemId: string) {
  const assignment = await ownerAssignment(user, organizationId, assignmentId);
  const content = await prisma.trainingContentItem.findFirst({ where: { id: contentItemId, module: { courseVersionId: assignment.courseVersionId } } });
  if (!content || content.contentType === "ACKNOWLEDGMENT" || content.contentType === "ASSESSMENT") throw new AuthorizationError("Employee acknowledgment or assessment cannot be administratively bypassed");
  const result = await completeContent(assignment.id, assignment.employeeId, content.id);
  await prisma.$transaction([
    prisma.trainingAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, eventType: "TRAINING_PROGRESS_ADMIN_ADVANCED", metadata: { contentItemId } } }),
    prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, employeeId: assignment.employeeId, eventType: "training.progress_admin_advanced", entityType: "TrainingAssignment", entityId: assignmentId, metadataJson: { contentItemId } } }),
  ]);
  return result;
}

export async function submitOwnerAssessment(user: Pick<User, "id">, organizationId: string, assignmentId: string, attemptId: string) {
  const assignment = await ownerAssignment(user, organizationId, assignmentId);
  return submitAttempt(attemptId, assignment.employeeId, {}, { actorUserId: user.id, administrative: true, assignmentId: assignment.id });
}
