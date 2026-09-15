import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEmployeeAuditRecord } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params, at = new URL(request.url).searchParams.get("at");
    return Response.json(await getEmployeeAuditRecord(user, organizationId, employeeId, at ? { mode: "POINT_IN_TIME", at: new Date(at) } : { mode: "CURRENT" }));
  } catch (error) { return errorResponse(error); }
}
