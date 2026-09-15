import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { queryAuditEvents } from "@/domain/audit/service";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, q = new URL(request.url).searchParams;
    return Response.json(await queryAuditEvents(user, organizationId, { employeeId: q.get("employeeId") ?? undefined, actorUserId: q.get("actorUserId") ?? undefined, eventType: q.get("eventType") ?? undefined, entityType: q.get("entityType") ?? undefined, entityId: q.get("entityId") ?? undefined, from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined, limit: q.get("limit") ? Number(q.get("limit")) : undefined }));
  } catch (error) { return errorResponse(error); }
}
