import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireOrganizationMembership } from "@/domain/permissions/authorization";
import { acknowledgePolicy } from "@/domain/policies/service";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ organizationId: string; assignmentId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), params = await context.params;
    await requireOrganizationMembership(user.id, params.organizationId);
    const assignment = await prisma.policyAssignment.findFirst({ where: { id: params.assignmentId, organizationId: params.organizationId, employee: { userId: user.id } }, include: { policyVersion: { include: { policy: true } }, attestation: true } });
    if (!assignment) throw new ResourceNotFoundError("Policy assignment not found");
    return Response.json(assignment);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), params = await context.params;
    const body = z.object({ typedName: z.string().min(1) }).parse(await request.json());
    return Response.json(await acknowledgePolicy(user, params.organizationId, params.assignmentId, { ...body, userAgent: request.headers.get("user-agent") ?? undefined, sessionReference: request.headers.get("x-session-reference") ?? undefined }));
  } catch (error) { return errorResponse(error); }
}
