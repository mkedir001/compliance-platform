import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { claimEmployeePortalInvitationByToken } from "@/domain/portal/service";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    await enforceRateLimit("portal-claim", requestRateKey(request, user.id), 10, 3600);
    const { token } = z.object({ token: z.string().min(32).max(256) }).strict().parse(await request.json());
    return Response.json(await claimEmployeePortalInvitationByToken(user, token));
  } catch (error) { return errorResponse(error); }
}
