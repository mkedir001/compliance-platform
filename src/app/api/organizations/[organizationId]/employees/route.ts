import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createEmployee, listEmployees } from "@/domain/workforce/service";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) { try { const user = await requireAuthenticatedUser(request); return Response.json(await listEmployees(user, (await context.params).organizationId)); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) { try { const user = await requireAuthenticatedUser(request); return Response.json(await createEmployee(user, (await context.params).organizationId, await request.json()), { status: 201 }); } catch (error) { return errorResponse(error); } }
