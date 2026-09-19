import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEmployeePortalAccess, inviteEmployeeToPortal } from "@/domain/portal/service";
import { revokeEmployeeInvitation, setEmployeeOrganizationAccess } from "@/domain/workforce-administration/service";
import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params; return Response.json(await getEmployeePortalAccess(user, organizationId, employeeId)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params, result = await inviteEmployeeToPortal(user, organizationId, employeeId); return Response.json({ invitation: result.invitation, delivery: "SECURE_DELIVERY_REQUIRED" }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params, body = z.object({ enabled: z.boolean(), reason: z.string() }).parse(await request.json()); return Response.json(await setEmployeeOrganizationAccess(user, organizationId, employeeId, body.enabled, body.reason)); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params, body = z.object({ invitationId: z.string().cuid(), reason: z.string() }).parse(await request.json()); return Response.json(await revokeEmployeeInvitation(user, organizationId, employeeId, body.invitationId, body.reason)); }
  catch (error) { return errorResponse(error); }
}
