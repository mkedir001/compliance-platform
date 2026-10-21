import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { inviteOrganizationUser, listOrganizationUsers } from "@/domain/organization-users/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params; return Response.json(await listOrganizationUsers(user, organizationId)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params; return Response.json(await inviteOrganizationUser(user, organizationId, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
