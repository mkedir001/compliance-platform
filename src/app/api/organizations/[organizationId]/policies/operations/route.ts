import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getPolicyOperationsSummary } from "@/domain/policies/service";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{return Response.json(await getPolicyOperationsSummary(await requireAuthenticatedUser(request),(await context.params).organizationId))}catch(error){return errorResponse(error)}}
