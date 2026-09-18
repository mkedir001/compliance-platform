import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getOrganizationSetup } from "@/domain/organization-setup/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await getOrganizationSetup(user,organizationId))}catch(error){return errorResponse(error)}}
