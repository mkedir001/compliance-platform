import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAxisCareAdministration, synchronizeAxisCare, verifyAxisCareConnection } from "@/domain/axiscare/administration";
import { axisCareConnectionInput, saveAxisCareConnection } from "@/domain/axiscare/config";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

async function manager(request: Request, organizationId: string) {
  const user = await requireAuthenticatedUser(request), { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "organization.manage");
  return user;
}

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const { organizationId } = await context.params, user = await manager(request, organizationId); return Response.json(await getAxisCareAdministration(user, organizationId)); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const { organizationId } = await context.params, user = await manager(request, organizationId); await enforceRateLimit("axiscare-configuration", requestRateKey(request, user.id), 5, 3600); return Response.json(await saveAxisCareConnection(organizationId, user.id, axisCareConnectionInput.parse(await request.json()))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const { organizationId } = await context.params, user = await manager(request, organizationId);
    await enforceRateLimit("axiscare-administration", requestRateKey(request, user.id), 10, 3600);
    const { action } = z.object({ action: z.enum(["TEST", "SYNC"]) }).strict().parse(await request.json());
    return Response.json(action === "TEST" ? await verifyAxisCareConnection(user, organizationId) : await synchronizeAxisCare(user, organizationId));
  } catch (error) { return errorResponse(error); }
}
