import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request); const { organizationId } = await context.params; const { organization, membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "organization.read"); return Response.json({ organization, permissions: [...await resolvePermissionCodes(membership.id)].sort(), roles: membership.roles.map((r) => r.roleDefinition) }); }
  catch (error) { return errorResponse(error); }
}
