import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAuditorPortal } from "@/domain/audit/access";
export async function GET(request:Request,context:{params:Promise<{sessionId:string}>}){try{const user=await requireAuthenticatedUser(request),{sessionId}=await context.params;return Response.json(await getAuditorPortal(user,sessionId))}catch(error){return errorResponse(error)}}
