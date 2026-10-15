import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { mapAxisCareCaregiver, mapAxisCareService } from "@/domain/axiscare/administration";

const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CAREGIVER"), externalId: z.string().min(1).max(200), employeeId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("SERVICE"), axisCareServiceCode: z.string().min(1).max(200), waldahServiceType: z.string().min(1).max(200) }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = input.parse(await request.json());
    return Response.json(body.kind === "CAREGIVER" ? await mapAxisCareCaregiver(user, organizationId, body.externalId, body.employeeId) : await mapAxisCareService(user, organizationId, body.axisCareServiceCode, body.waldahServiceType));
  } catch (error) { return errorResponse(error); }
}
