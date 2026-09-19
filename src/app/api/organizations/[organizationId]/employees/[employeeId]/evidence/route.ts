import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getEmployeeEvidenceOperations } from "@/domain/evidence/operations";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;employeeId:string}>}){try{const user=await requireAuthenticatedUser(request),params=await context.params;return Response.json(await getEmployeeEvidenceOperations(user,params.organizationId,params.employeeId))}catch(error){return errorResponse(error)}}
