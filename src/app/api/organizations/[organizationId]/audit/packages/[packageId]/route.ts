import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAuditPackage } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; packageId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId, packageId } = await context.params; return Response.json(await getAuditPackage(user, organizationId, packageId)); }
  catch (error) { return errorResponse(error); }
}
