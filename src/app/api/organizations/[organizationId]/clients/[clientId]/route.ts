import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getClient, updateClientLifecycle } from "@/domain/clients/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;clientId:string}>}){try{const user=await requireAuthenticatedUser(request),p=await context.params;return Response.json(await getClient(user,p.organizationId,p.clientId))}catch(error){return errorResponse(error)}}
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string;clientId:string}>}){try{const user=await requireAuthenticatedUser(request),p=await context.params;await updateClientLifecycle(user,p.organizationId,p.clientId,await request.json());return Response.json(await getClient(user,p.organizationId,p.clientId))}catch(error){return errorResponse(error)}}
