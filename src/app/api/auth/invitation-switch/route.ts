import { z } from "zod";
import { requireVerifiedInvitationIdentity } from "@/domain/auth/authentication";
import { claimContinuationCookie, claimContinuationMaxAge, cognitoLogoutUrl, createClaimContinuation } from "@/domain/auth/claim-continuation";
import { errorResponse } from "@/domain/auth/errors";
import { inspectEmployeePortalInvitation } from "@/domain/portal/service";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const identity = await requireVerifiedInvitationIdentity(request);
    await enforceRateLimit("portal-invitation-switch", requestRateKey(request, identity.subject), 10, 3600);
    const { token } = z.object({ token: z.string().min(32).max(256) }).strict().parse(await request.json()), inspection = await inspectEmployeePortalInvitation(token);
    if (inspection.state !== "VALID") return Response.json(inspection, { status: 409, headers: { "cache-control": "no-store" } });
    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.append("set-cookie", `${claimContinuationCookie}=${createClaimContinuation(token)}; Max-Age=${claimContinuationMaxAge()}; Path=/learn/claim/resume; HttpOnly; Secure; SameSite=Lax`);
    for (const name of ["AWSELBAuthSessionCookie", ...Array.from({ length: 8 }, (_, index) => `AWSELBAuthSessionCookie-${index}`)]) headers.append("set-cookie", `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return new Response(JSON.stringify({ logoutUrl: cognitoLogoutUrl() }), { status: 200, headers });
  } catch (error) { const response = errorResponse(error); response.headers.set("cache-control", "no-store"); response.headers.set("referrer-policy", "no-referrer"); return response; }
}
