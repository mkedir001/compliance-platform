import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getAuditorDocumentPdf } from "@/domain/audit/access";
export async function GET(request:Request,context:{params:Promise<{sessionId:string;documentId:string}>}){try{const user=await requireAuthenticatedUser(request),{sessionId,documentId}=await context.params,pdf=await getAuditorDocumentPdf(user,sessionId,documentId);return new Response(pdf,{headers:{"content-type":"application/pdf","content-disposition":"attachment; filename=auditor-document.pdf"}})}catch(error){return errorResponse(error)}}
