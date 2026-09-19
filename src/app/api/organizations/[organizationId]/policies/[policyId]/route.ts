import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { archivePolicy, correctPolicyMetadata, getPolicyDetail } from "@/domain/policies/service";
type Context={params:Promise<{organizationId:string;policyId:string}>};
export async function GET(request:Request,context:Context){try{const user=await requireAuthenticatedUser(request),params=await context.params;return Response.json(await getPolicyDetail(user,params.organizationId,params.policyId))}catch(error){return errorResponse(error)}}
export async function PATCH(request:Request,context:Context){try{const user=await requireAuthenticatedUser(request),params=await context.params,body=await request.json(),action=z.enum(["CORRECT_METADATA","ARCHIVE"]).parse(body.action);return Response.json(action==="ARCHIVE"?await archivePolicy(user,params.organizationId,params.policyId,z.string().parse(body.reason)):await correctPolicyMetadata(user,params.organizationId,params.policyId,body.input))}catch(error){return errorResponse(error)}}
