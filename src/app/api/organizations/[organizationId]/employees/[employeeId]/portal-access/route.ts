import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEmployeePortalAccess, inviteEmployeeToPortal } from "@/domain/portal/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params; return Response.json(await getEmployeePortalAccess(user, organizationId, employeeId)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params; return Response.json(await inviteEmployeeToPortal(user, organizationId, employeeId), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
