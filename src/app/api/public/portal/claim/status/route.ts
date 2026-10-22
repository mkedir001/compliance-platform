import { z } from "zod";
import { inspectPublicInvitation, publicInvitationToken } from "@/domain/portal/public-invitation";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { token } = z.object({ token: publicInvitationToken }).strict().parse(await request.json());
    await enforceRateLimit("public-portal-invitation-status", requestRateKey(request, token), 20, 3600);
    const result = await inspectPublicInvitation(token);
    return Response.json(result, { status: result.state === "INVALID" ? 404 : 200, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    return Response.json({ state: invalid ? "INVALID" : "UNAVAILABLE" }, { status: invalid ? 404 : 503, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", ...(invalid ? {} : { "retry-after": "5" }) } });
  }
}
