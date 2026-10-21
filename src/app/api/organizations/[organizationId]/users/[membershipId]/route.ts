import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { updateOrganizationMembership } from "@/domain/organization-users/service";

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; membershipId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, membershipId } = await context.params; return Response.json(await updateOrganizationMembership(user, organizationId, membershipId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
