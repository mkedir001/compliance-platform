import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { listAssignableOrganizationRoles } from "@/domain/workforce-administration/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await listAssignableOrganizationRoles(user,organizationId))}catch(error){return errorResponse(error)}}
