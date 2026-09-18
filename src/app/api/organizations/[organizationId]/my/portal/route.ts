import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEmployeePortal } from "@/domain/portal/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params; return Response.json(await getEmployeePortal(user, organizationId)); }
  catch (error) { return errorResponse(error); }
}
