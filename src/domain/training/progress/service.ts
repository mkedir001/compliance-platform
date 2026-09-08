import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/domain/auth/errors";
import { deriveAndCreateCompletion } from "../completion/service";
import { startAssignment } from "../assignments/service";

const blockedStatuses = ["COMPLETED", "TRAINING_COMPLETE_COMPETENCY_PENDING", "CANCELLED", "SUPERSEDED"] as const;

async function ensureProgressAllowed(assignmentId: string, employeeId: string) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, employeeId } });
  if (!assignment || blockedStatuses.some(status => status === assignment.status)) throw new AuthorizationError("Assignment does not accept progress updates");
  if (assignment.status === "NOT_STARTED") await startAssignment(assignmentId, employeeId);
}

export async function completeContent(assignmentId: string, employeeId: string, contentItemId: string) {
  await ensureProgressAllowed(assignmentId, employeeId);
  const item = await prisma.trainingContentItem.findFirst({ where: { id: contentItemId, module: { courseVersion: { assignments: { some: { id: assignmentId, employeeId } } } } } });
  if (!item || item.contentType === "ACKNOWLEDGMENT" || item.contentType === "ASSESSMENT") throw new AuthorizationError("Content is not completable for this assignment");
  const now = new Date();
  await prisma.trainingContentProgress.upsert({ where: { assignmentId_contentItemId: { assignmentId, contentItemId } }, create: { assignmentId, contentItemId, status: "COMPLETED", startedAt: now, completedAt: now, lastViewedAt: now }, update: { status: "COMPLETED", completedAt: now, lastViewedAt: now } });
  return deriveAndCreateCompletion(assignmentId);
}

export async function acknowledgeContent(assignmentId: string, employeeId: string, userId: string, contentItemId: string) {
  await ensureProgressAllowed(assignmentId, employeeId);
  const item = await prisma.trainingContentItem.findFirst({ where: { id: contentItemId, contentType: "ACKNOWLEDGMENT", module: { courseVersion: { assignments: { some: { id: assignmentId, employeeId } } } } } });
  if (!item) throw new AuthorizationError("Acknowledgment is not part of this assignment");
  await prisma.trainingAcknowledgment.upsert({ where: { assignmentId_contentItemId: { assignmentId, contentItemId } }, create: { assignmentId, contentItemId, employeeId, acknowledgedByUserId: userId }, update: {} });
  return deriveAndCreateCompletion(assignmentId);
}
