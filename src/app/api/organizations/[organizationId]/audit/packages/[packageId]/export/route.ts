import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAuditPackage } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; packageId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, packageId } = await context.params, result = await getAuditPackage(user, organizationId, packageId, true);
    return new Response(JSON.stringify(result.manifestJson), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="audit-package-${result.id}.json"`, "x-audit-integrity-sha256": result.integrityDigest ?? "" } });
  } catch (error) { return errorResponse(error); }
}
