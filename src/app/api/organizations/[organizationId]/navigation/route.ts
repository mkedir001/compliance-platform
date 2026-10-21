import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { requireOrganizationMembership, resolvePermissionCodes } from "@/domain/permissions/authorization";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, membership = await requireOrganizationMembership(user.id, organizationId), permissions = await resolvePermissionCodes(membership.id); return Response.json({ billing: permissions.has("billing.view") || permissions.has("billing.run") || permissions.has("billing.view_billed"), users: permissions.has("user.read"), settings: permissions.has("organization.manage") || permissions.has("user.read") }); }
  catch (error) { return errorResponse(error); }
}
