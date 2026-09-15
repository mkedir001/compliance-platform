import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getRequirementEvidenceTrace } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; requirementVersionId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, requirementVersionId } = await context.params, query = new URL(request.url).searchParams, at = query.get("at");
    return Response.json(await getRequirementEvidenceTrace(user, organizationId, requirementVersionId, query.get("employeeId") ?? undefined, at ? { mode: "POINT_IN_TIME", at: new Date(at) } : { mode: "CURRENT" }));
  } catch (error) { return errorResponse(error); }
}
