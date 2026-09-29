import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getClient } from "@/domain/clients/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;clientId:string}>}){try{const user=await requireAuthenticatedUser(request),p=await context.params;return Response.json(await getClient(user,p.organizationId,p.clientId))}catch(error){return errorResponse(error)}}
