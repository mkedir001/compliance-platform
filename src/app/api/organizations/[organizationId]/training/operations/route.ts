import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { listTrainingOperations } from "@/domain/training/operations/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, url = new URL(request.url);
    return Response.json(await listTrainingOperations(user, organizationId, { employee: url.searchParams.get("employee") || undefined, employeeId: url.searchParams.get("employeeId") || undefined, course: url.searchParams.get("course") || undefined, status: url.searchParams.get("status") || undefined, attention: url.searchParams.get("attention") === "true" }));
  } catch (error) { return errorResponse(error); }
}
