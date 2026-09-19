import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { requireEmployeeAccess } from "@/domain/permissions/authorization";
import { ValidationError } from "@/domain/auth/errors";
import { correctEmployeeAdministration } from "@/domain/workforce-administration/service";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params; return Response.json((await requireEmployeeAccess(user, p.organizationId, p.employeeId)).employee); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request); const p = await context.params, body=await request.json(); if(["employmentStatus","terminationDate","userId"].some(key=>key in body))throw new ValidationError("Use the controlled lifecycle or account workflow for this field"); if(!body.reason)throw new ValidationError("An administrative correction reason is required"); return Response.json(await correctEmployeeAdministration(user, p.organizationId, p.employeeId, body)); } catch (error) { return errorResponse(error); } }
