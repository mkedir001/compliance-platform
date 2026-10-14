import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export async function GET(request:Request,context:{params:Promise<{organizationId:string;versionId:string}>}){
 try{const user=await requireAuthenticatedUser(request),{organizationId,versionId}=await context.params,{membership}=await requireOrganizationAccess(user,organizationId);await requirePermission(membership.id,"policy.read");const version=await prisma.policyVersion.findFirst({where:{id:versionId,policy:{organizationId}},select:{originalDocument:true,originalFileName:true,originalMimeType:true}});if(!version?.originalDocument)throw new ResourceNotFoundError("Policy document not found");return new Response(version.originalDocument,{headers:{"content-type":version.originalMimeType??"application/pdf","content-disposition":`inline; filename="${(version.originalFileName??"policy.pdf").replace(/[\"\\]/g,"_")}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}})}catch(error){return errorResponse(error)}
}
