import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { approveClinicalCurriculum, revokeClinicalCurriculumApproval } from "@/domain/medication/service";

type Context = { params: Promise<{ organizationId: string; courseVersionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, courseVersionId } = await context.params;
    return Response.json(await approveClinicalCurriculum(user, organizationId, courseVersionId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params;
    const input = z.object({ approvalId: z.string().cuid(), reason: z.string().trim().min(3).max(1000) }).parse(await request.json());
    return Response.json(await revokeClinicalCurriculumApproval(user, organizationId, input.approvalId, input.reason));
  } catch (error) { return errorResponse(error); }
}
