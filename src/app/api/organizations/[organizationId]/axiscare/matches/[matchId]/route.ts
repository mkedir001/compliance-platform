import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { ResourceNotFoundError, errorResponse } from "@/domain/auth/errors";
import { confirmClientMatch, rejectClientMatch } from "@/domain/axiscare/sync";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";

// One-time confirmation of a suggested AxisCare-to-Waldah client match. Requires mapping authority.
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; matchId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, matchId } = await context.params;
    const { action } = z.object({ action: z.enum(["CONFIRM", "REJECT"]) }).strict().parse(await request.json());
    const { membership } = await requireOrganizationAccess(user, organizationId);
    await requirePermission(membership.id, "billing.mapping.manage");
    if (action === "CONFIRM") {
      const clientId = await confirmClientMatch(organizationId, matchId, user.id);
      if (!clientId) throw new ResourceNotFoundError("Suggested match not found");
      return Response.json({ status: "CONFIRMED", clientId });
    }
    if (!(await rejectClientMatch(organizationId, matchId, user.id))) throw new ResourceNotFoundError("Suggested match not found");
    return Response.json({ status: "REJECTED" });
  } catch (error) {
    return errorResponse(error);
  }
}
