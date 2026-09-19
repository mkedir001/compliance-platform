import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { claimEmployeePortalInvitation } from "@/domain/portal/service";
import { enforceRateLimit,requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params;await enforceRateLimit("portal-claim",requestRateKey(request,user.id),10,3600);const { token } = z.object({ token: z.string().min(32).max(256) }).parse(await request.json()); return Response.json(await claimEmployeePortalInvitation(user, organizationId, token)); }
  catch (error) { return errorResponse(error); }
}
