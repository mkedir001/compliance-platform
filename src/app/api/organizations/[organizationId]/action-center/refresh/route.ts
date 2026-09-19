import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { refreshActionCenter } from "@/domain/action-center/service";
import { enforceRateLimit,requestRateKey } from "@/lib/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) { try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params;await enforceRateLimit("action-center-refresh",requestRateKey(request,user.id),10,60);const body = z.object({ evaluatedAt: z.coerce.date().optional() }).parse(await request.json().catch(() => ({}))); return Response.json(await refreshActionCenter(user, organizationId, body.evaluatedAt)); } catch (error) { return errorResponse(error); } }
