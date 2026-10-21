import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { ResourceNotFoundError, errorResponse } from "@/domain/auth/errors";
import { createClientFromAxisCare } from "@/domain/axiscare/create-client";
import { changeAxisCareClientDisposition, confirmExplicitClientMatch } from "@/domain/axiscare/sync";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";

const externalId = z.string().trim().min(1).max(200);
const input = z.union([
  z.object({ action: z.literal("CREATE_CLIENT"), axisCareClientId: externalId }).strict(),
  z.object({ axisCareClientId: externalId, clientId: z.string().min(1) }).strict(),
  z.object({ action: z.enum(["IGNORE", "RESTORE"]), axisCareClientIds: z.array(externalId).min(1).max(200) }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = input.parse(await request.json());
    const { membership } = await requireOrganizationAccess(user, organizationId);
    await requirePermission(membership.id, "billing.run");
    if ("action" in body && body.action === "CREATE_CLIENT") {
      const clientId = await createClientFromAxisCare(user, organizationId, body.axisCareClientId);
      return Response.json({ status: "CREATED", clientId });
    }
    if ("action" in body) {
      const results = await changeAxisCareClientDisposition(organizationId, body.axisCareClientIds, user.id, body.action);
      const changedStatus = body.action === "IGNORE" ? "IGNORED" : "RESTORED";
      return Response.json({ results, changed: results.filter(result => result.status === changedStatus).length, requested: body.axisCareClientIds.length });
    }
    const clientId = await confirmExplicitClientMatch(organizationId, body.axisCareClientId, body.clientId, user.id);
    if (!clientId) throw new ResourceNotFoundError("AxisCare client or Waldah client not found");
    return Response.json({ status: "CONFIRMED", clientId });
  } catch (error) { return errorResponse(error); }
}
