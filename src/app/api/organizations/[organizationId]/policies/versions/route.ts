import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createPolicyVersion, publishPolicyVersion, updateDraftPolicyVersion } from "@/domain/policies/service";
const schema=z.object({policyId:z.string(),effectiveFrom:z.coerce.date(),body:z.string().min(1)});
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),body=schema.parse(await request.json());return Response.json(await createPolicyVersion(user,(await context.params).organizationId,body.policyId,body),{status:201})}catch(error){return errorResponse(error)}}
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),body=await request.json(),parsed=z.object({id:z.string(),action:z.enum(["PUBLISH","UPDATE_DRAFT"]),input:z.unknown().optional()}).parse(body),organizationId=(await context.params).organizationId;return Response.json(parsed.action==="PUBLISH"?await publishPolicyVersion(user,organizationId,parsed.id):await updateDraftPolicyVersion(user,organizationId,parsed.id,parsed.input))}catch(error){return errorResponse(error)}}
