import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { cancelOrganizationInvitation, reissueOrganizationInvitation } from "@/domain/organization-users/service";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; invitationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, invitationId } = await context.params, { action } = z.object({ action: z.enum(["CANCEL", "REISSUE"]) }).strict().parse(await request.json()); return Response.json(action === "CANCEL" ? await cancelOrganizationInvitation(user, organizationId, invitationId) : await reissueOrganizationInvitation(user, organizationId, invitationId)); }
  catch (error) { return errorResponse(error); }
}
