import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeSelfAccess } from "@/domain/permissions/authorization";
import { finalizeTrainingAssignment } from "@/domain/training/completion/service";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; assignmentId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { organizationId, assignmentId } = await context.params;
    const assignment = await prisma.trainingAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!assignment) throw new ResourceNotFoundError("Assignment not found");
    await requireEmployeeSelfAccess(user, organizationId, assignment.employeeId);
    const completion = await finalizeTrainingAssignment(assignment.id);
    return completion ? Response.json(completion) : Response.json({ error: "Training prerequisites are incomplete" }, { status: 409 });
  } catch (error) {
    return errorResponse(error);
  }
}
