import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEvidenceOperationsSummary } from "@/domain/evidence/operations";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{return Response.json(await getEvidenceOperationsSummary(await requireAuthenticatedUser(request),(await context.params).organizationId))}catch(error){return errorResponse(error)}}
