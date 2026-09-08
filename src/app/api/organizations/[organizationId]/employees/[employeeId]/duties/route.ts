import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { assignEmployeeDuty } from "@/domain/workforce/service";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params; return Response.json(await assignEmployeeDuty(user, p.organizationId, p.employeeId, await request.json()), { status: 201 }); } catch (error) { return errorResponse(error); } }
