import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createAuditAccessSession, getAuditAccessManagement } from "@/domain/audit/access";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await getAuditAccessManagement(user,organizationId))}catch(error){return errorResponse(error)}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await createAuditAccessSession(user,organizationId,await request.json()),{status:201})}catch(error){return errorResponse(error)}}
