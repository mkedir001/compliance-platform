import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { requireEmployeeAccess } from "@/domain/permissions/authorization";
import { updateEmployee } from "@/domain/workforce/service";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params; return Response.json((await requireEmployeeAccess(user, p.organizationId, p.employeeId)).employee); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params; return Response.json(await updateEmployee(user, p.organizationId, p.employeeId, await request.json())); } catch (error) { return errorResponse(error); } }
