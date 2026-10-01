import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getClientDocumentationReadiness } from "@/domain/clients/readiness";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;clientId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId,clientId}=await context.params;return Response.json(await getClientDocumentationReadiness(user,organizationId,clientId))}catch(error){return errorResponse(error)}}
