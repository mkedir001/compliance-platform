import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { configureOrganizationProgram } from "@/domain/organization-setup/service";
export async function PUT(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;return Response.json(await configureOrganizationProgram(user,organizationId,await request.json()))}catch(error){return errorResponse(error)}}
