import { Prisma, type TrainingAssignmentStatus, type User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { assignmentSchema, bulkAssignmentSchema, cancellationSchema } from "../schemas";
import { getAssignableCourseVersion } from "../catalog/service";
import { validateCourseVersion } from "../curriculum/service";

const terminalStatuses: TrainingAssignmentStatus[] = ["COMPLETED", "TRAINING_COMPLETE_COMPETENCY_PENDING", "CANCELLED", "SUPERSEDED"];

async function requireAssignableVersion(organizationId: string, courseVersionId: string) {
  const version = await getAssignableCourseVersion(organizationId, courseVersionId);
  if (!version) throw new AuthorizationError("Course version is not published or available to this organization");
  if (version.course.ownershipType === "PLATFORM" && version.status === "ACTIVE") {
    const validation = await validateCourseVersion(version.id);
    if (!validation.valid) throw new AuthorizationError("Active production course version failed curriculum validation");
  }
  return version;
}

export async function createManualAssignment(user: Pick<User, "id">, organizationId: string, input: unknown) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "training.assignment.manage");
  const data = assignmentSchema.parse(input);
  await requireEmployeeAccess(user, organizationId, data.employeeId, "employee.read");
  await requireAssignableVersion(organizationId, data.courseVersionId);
  const activeKey = `${organizationId}:${data.employeeId}:${data.courseVersionId}`;
  const existing = await prisma.trainingAssignment.findFirst({ where: { organizationId, employeeId: data.employeeId, courseVersionId: data.courseVersionId, status: { not: "CANCELLED" } } });
  if (existing) return existing.activeKey ? existing : prisma.trainingAssignment.update({ where: { id: existing.id }, data: { activeKey } });
  try {
    return await prisma.trainingAssignment.upsert({
      where: { activeKey }, update: {},
      create: { activeKey, fingerprint: `manual:${activeKey}:${randomUUID()}`, organizationId, employeeId: data.employeeId, courseVersionId: data.courseVersionId, sourceType: "MANUAL", assignedByUserId: user.id, dueAt: data.dueAt, events: { create: { organizationId, actorUserId: user.id, eventType: "TRAINING_ASSIGNED" } } },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.trainingAssignment.findUniqueOrThrow({ where: { activeKey } });
    throw error;
  }
}

export async function createManualAssignments(user: Pick<User, "id">, organizationId: string, input: unknown) {
  const data = bulkAssignmentSchema.parse(input);
  return Promise.all([...new Set(data.employeeIds)].map(employeeId => createManualAssignment(user, organizationId, { ...data, employeeId })));
}

export async function assignTrainingForCompliance(complianceInstanceId: string) {
  const instance = await prisma.complianceInstance.findUnique({ where: { id: complianceInstanceId }, include: { requirementVersion: { include: { trainingOptions: { where: { isDefault: true }, include: { trainingCourseVersion: { include: { course: true } } } } } } } });
  if (!instance) return null;
  const now = new Date();
  const option = instance.requirementVersion.trainingOptions.find(o => ["PUBLISHED", "ACTIVE"].includes(o.trainingCourseVersion.status) && (!o.effectiveFrom || o.effectiveFrom <= now) && (!o.effectiveUntil || o.effectiveUntil >= now) && (!o.trainingCourseVersion.course.organizationId || o.trainingCourseVersion.course.organizationId === instance.organizationId));
  if (!option) return null;
  const fingerprint = `compliance:${instance.id}:${option.trainingCourseVersionId}`;
  const activeKey = `${instance.organizationId}:${instance.employeeId}:${option.trainingCourseVersionId}`;
  const existing = await prisma.trainingAssignment.findUnique({ where: { activeKey } });
  if (existing) return existing;
  const existingForInstance = await prisma.trainingAssignment.findUnique({ where: { fingerprint } });
  if (existingForInstance) return existingForInstance.activeKey ? existingForInstance : prisma.trainingAssignment.update({ where: { id: existingForInstance.id }, data: { activeKey, dueAt: instance.nominalDueAt } });
  return prisma.trainingAssignment.upsert({
    where: { fingerprint },
    create: { fingerprint, activeKey, organizationId: instance.organizationId, employeeId: instance.employeeId, courseVersionId: option.trainingCourseVersionId, sourceType: "COMPLIANCE_ENGINE", sourceReferenceId: instance.id, complianceInstanceId: instance.id, dueAt: instance.nominalDueAt, events: { create: { organizationId: instance.organizationId, eventType: "TRAINING_ASSIGNED", metadata: { complianceInstanceId: instance.id } } } },
    update: { dueAt: instance.nominalDueAt },
  });
}

export async function startAssignment(assignmentId: string, employeeId: string, actorUserId?: string) {
  return prisma.$transaction(async tx => {
    const assignment = await tx.trainingAssignment.findFirst({ where: { id: assignmentId, employeeId } });
    if (!assignment) throw new ResourceNotFoundError("Training assignment not found");
    if (assignment.status === "IN_PROGRESS") return assignment;
    if (assignment.status !== "NOT_STARTED") throw new AuthorizationError("Assignment cannot be started from its current state");
    const started = await tx.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await tx.trainingAssignmentEvent.create({ data: { organizationId: assignment.organizationId, assignmentId, actorUserId, eventType: "TRAINING_STARTED" } });
    return started;
  });
}

export async function cancelAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string, input: unknown) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "training.assignment.manage");
  const { reason } = cancellationSchema.parse(input);
  return prisma.$transaction(async tx => {
    const assignment = await tx.trainingAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!assignment) throw new ResourceNotFoundError("Training assignment not found");
    if (assignment.status === "CANCELLED") return assignment;
    if (terminalStatuses.includes(assignment.status)) throw new AuthorizationError("Completed or superseded training cannot be cancelled");
    const cancelled = await tx.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", activeKey: null, cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: reason } });
    await tx.trainingAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, eventType: "TRAINING_CANCELLED", metadata: { reason } } });
    return cancelled;
  });
}

export function deriveAssignmentDisplayStatus(assignment: { status: TrainingAssignmentStatus; dueAt: Date | null }, now = new Date()) {
  if (!terminalStatuses.includes(assignment.status) && assignment.dueAt && assignment.dueAt < now) return "OVERDUE" as const;
  return assignment.status;
}

export async function getAssignment(organizationId: string, employeeId: string, assignmentId: string) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, organizationId, employeeId }, include: { courseVersion: { include: { course: true, modules: { orderBy: { sequence: "asc" }, include: { contentItems: { orderBy: { sequence: "asc" } }, assessments: { where: { status: "PUBLISHED" }, include: { questions: { orderBy: { sequence: "asc" }, select: { id: true, questionType: true, prompt: true, sequence: true, points: true, critical: true, options: { orderBy: { sequence: "asc" }, select: { id: true, text: true, sequence: true } } } } } } } } } }, moduleProgress: true, contentProgress: true, acknowledgments: true, attempts: true, completion: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!assignment) throw new ResourceNotFoundError("Training assignment not found");
  return { ...assignment, displayStatus: deriveAssignmentDisplayStatus(assignment) };
}
