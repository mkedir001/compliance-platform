import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeSelfAccess } from "@/domain/permissions/authorization";
import { saveAssessmentDraftResponse } from "@/domain/training/assessments/service";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; assignmentId: string; attemptId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), params = await context.params;
    const assignment = await prisma.trainingAssignment.findFirst({ where: { id: params.assignmentId, organizationId: params.organizationId } });
    if (!assignment) throw new ResourceNotFoundError("Assignment not found");
    await requireEmployeeSelfAccess(user, params.organizationId, assignment.employeeId);
    return Response.json(await saveAssessmentDraftResponse(params.attemptId, assignment.employeeId, await request.json(), { actorUserId: user.id, assignmentId: assignment.id }));
  } catch (error) { return errorResponse(error); }
}
