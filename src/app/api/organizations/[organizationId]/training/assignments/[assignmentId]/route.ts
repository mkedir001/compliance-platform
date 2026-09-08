import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { cancelAssignment } from "@/domain/training/assignments/service";

export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string; assignmentId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { organizationId, assignmentId } = await context.params;
    return Response.json(await cancelAssignment(user, organizationId, assignmentId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
