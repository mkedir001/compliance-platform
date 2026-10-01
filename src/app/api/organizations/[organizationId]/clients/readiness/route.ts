import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getOrganizationClientDocumentationReadiness } from "@/domain/clients/readiness";
const filter=z.enum(["ALL","CURRENT","ATTENTION_NEEDED","MISSING","DUE_SOON","OVERDUE","OUTSTANDING_REQUESTS"]);
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params,value=new URL(request.url).searchParams.get("filter");return Response.json(await getOrganizationClientDocumentationReadiness(user,organizationId,{filter:value?filter.parse(value):"ALL"}))}catch(error){return errorResponse(error)}}
