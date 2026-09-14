import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { evaluateEmployeeOperations, getEmployeeOperationalProfile } from "@/domain/compliance/operations/service";

type Context = { params: Promise<{ organizationId: string; employeeId: string }> };
export async function GET(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), params = await context.params; return Response.json(await getEmployeeOperationalProfile(user, params.organizationId, params.employeeId)); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), params = await context.params; return Response.json(await evaluateEmployeeOperations(user, params.organizationId, params.employeeId)); } catch (error) { return errorResponse(error); } }
