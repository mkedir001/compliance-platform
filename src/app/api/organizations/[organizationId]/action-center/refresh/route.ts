import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { refreshActionCenter } from "@/domain/action-center/service";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) { try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = z.object({ evaluatedAt: z.coerce.date().optional() }).parse(await request.json().catch(() => ({}))); return Response.json(await refreshActionCenter(user, organizationId, body.evaluatedAt)); } catch (error) { return errorResponse(error); } }
