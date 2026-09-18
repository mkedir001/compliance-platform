import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { claimEmployeePortalInvitation } from "@/domain/portal/service";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, { token } = z.object({ token: z.string().min(32) }).parse(await request.json()); return Response.json(await claimEmployeePortalInvitation(user, organizationId, token)); }
  catch (error) { return errorResponse(error); }
}
