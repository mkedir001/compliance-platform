import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { equivalencySchema } from "@/domain/evidence/schemas";
import { createExternalTrainingForEmployee } from "@/domain/evidence/operations";
import { decideEquivalency } from "@/domain/evidence/service";
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),body=await request.json(),employeeId=z.string().parse(body.employeeId),{employeeId:_,...input}=body;void _;return Response.json(await createExternalTrainingForEmployee(user,(await context.params).organizationId,employeeId,input),{status:201})}catch(error){return errorResponse(error)}}
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request);return Response.json(await decideEquivalency(user.id,(await context.params).organizationId,equivalencySchema.parse(await request.json())))}catch(error){return errorResponse(error)}}
