import { z } from "zod";
import { inspectEmployeePortalInvitation } from "@/domain/portal/service";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { token } = z.object({ token: z.string().min(32).max(256) }).strict().parse(await request.json());
    await enforceRateLimit("public-portal-invitation-status", requestRateKey(request, token), 20, 3600);
    return Response.json(await inspectEmployeePortalInvitation(token), { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch {
    return Response.json({ state: "INVALID" }, { status: 404, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
}
