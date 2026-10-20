import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { ResourceNotFoundError, errorResponse } from "@/domain/auth/errors";
import { confirmExplicitClientMatch } from "@/domain/axiscare/sync";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";

const input = z.object({ axisCareClientId: z.string().min(1).max(200), clientId: z.string().min(1) }).strict();

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = input.parse(await request.json());
    const { membership } = await requireOrganizationAccess(user, organizationId);
    await requirePermission(membership.id, "billing.run");
    const clientId = await confirmExplicitClientMatch(organizationId, body.axisCareClientId, body.clientId, user.id);
    if (!clientId) throw new ResourceNotFoundError("AxisCare client or Waldah client not found");
    return Response.json({ status: "CONFIRMED", clientId });
  } catch (error) { return errorResponse(error); }
}
