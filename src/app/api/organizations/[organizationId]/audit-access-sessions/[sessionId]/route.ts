import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { revokeAuditAccessSession, updateAuditAccessSession } from "@/domain/audit/access";
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string;sessionId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId,sessionId}=await context.params,body=await request.json();if(body.action==="REVOKE")return Response.json(await revokeAuditAccessSession(user,organizationId,sessionId,z.string().parse(body.reason)));if(body.action==="UPDATE")return Response.json(await updateAuditAccessSession(user,organizationId,sessionId,body.session));throw new Error("Unsupported audit access action")}catch(error){return errorResponse(error)}}
