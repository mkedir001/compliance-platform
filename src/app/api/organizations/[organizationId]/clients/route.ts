import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createClient, listClients } from "@/domain/clients/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params,q=new URL(request.url).searchParams;return Response.json(await listClients(user,organizationId,{search:q.get("search")??undefined,status:q.get("status")??undefined}))}catch(error){return errorResponse(error)}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await createClient(user,organizationId,await request.json()),{status:201})}catch(error){return errorResponse(error)}}
