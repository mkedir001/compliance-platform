import { z } from "zod";
import { requireVerifiedInvitationIdentity } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { claimEmployeePortalInvitationByIdentity } from "@/domain/portal/service";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const identity = await requireVerifiedInvitationIdentity(request);
    await enforceRateLimit("portal-claim", requestRateKey(request, identity.subject), 10, 3600);
    const { token } = z.object({ token: z.string().min(32).max(256) }).strict().parse(await request.json());
    return Response.json(await claimEmployeePortalInvitationByIdentity(identity, token), { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) { const response = errorResponse(error); response.headers.set("cache-control", "no-store"); response.headers.set("referrer-policy", "no-referrer"); return response; }
}
