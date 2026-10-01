import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAuditorPackage } from "@/domain/audit/access";
export async function GET(request:Request,context:{params:Promise<{sessionId:string;packageId:string}>}){try{const user=await requireAuthenticatedUser(request),{sessionId,packageId}=await context.params,item=await getAuditorPackage(user,sessionId,packageId);return new Response(JSON.stringify(item.manifestJson),{headers:{"content-type":"application/json","content-disposition":"attachment; filename=auditor-package.json","x-audit-integrity-sha256":item.integrityDigest??""}})}catch(error){return errorResponse(error)}}
