import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import {
  createCleanupPreview,
  executeCleanupPreview,
  getCleanupAuditHistory,
  markTestData,
  searchCleanupCandidates,
} from "@/domain/test-data-cleanup/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request),
      { organizationId } = await context.params,
      url = new URL(request.url);
    if (url.searchParams.get("view") === "history")
      return Response.json(await getCleanupAuditHistory(user, organizationId));
    return Response.json(
      await searchCleanupCandidates(user, organizationId, {
        type: url.searchParams.get("type") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request),
      { organizationId } = await context.params,
      body = await request.json();
    if (body.action === "MARK")
      return Response.json(await markTestData(user, organizationId, body));
    if (body.action === "PREVIEW")
      return Response.json(
        await createCleanupPreview(user, organizationId, body.selections),
      );
    if (body.action === "EXECUTE")
      return Response.json(
        await executeCleanupPreview(user, organizationId, body.previewId, body),
      );
    return Response.json(
      { error: "Unsupported cleanup action" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
