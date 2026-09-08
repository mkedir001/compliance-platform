import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { removeEmployeeDuty } from "@/domain/workforce/service";
export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string; dutyId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params; return Response.json(await removeEmployeeDuty(user, p.organizationId, p.employeeId, p.dutyId)); } catch (error) { return errorResponse(error); } }
