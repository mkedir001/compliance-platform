import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getOrganizationAuditSummary } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, at = new URL(request.url).searchParams.get("at"); return Response.json(await getOrganizationAuditSummary(user, organizationId, at ? new Date(at) : new Date())); }
  catch (error) { return errorResponse(error); }
}
