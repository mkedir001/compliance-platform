import type { AuditPackageScope } from "@prisma/client";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createAuditPackage } from "@/domain/audit/service";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = await request.json() as { scope: AuditPackageScope; subjectId?: string; pointInTimeAt?: string };
    return Response.json(await createAuditPackage(user, organizationId, { scope: body.scope, subjectId: body.subjectId, pointInTimeAt: body.pointInTimeAt ? new Date(body.pointInTimeAt) : undefined }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
