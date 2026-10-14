import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { requireEmployeeSelfAccess } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export async function GET(request:Request,context:{params:Promise<{organizationId:string;assignmentId:string}>}){
 try{const user=await requireAuthenticatedUser(request),{organizationId,assignmentId}=await context.params,assignment=await prisma.policyAssignment.findFirst({where:{id:assignmentId,organizationId},include:{policyVersion:true}});if(!assignment)throw new ResourceNotFoundError("Policy assignment not found");await requireEmployeeSelfAccess(user,organizationId,assignment.employeeId);if(!assignment.policyVersion.originalDocument)throw new ResourceNotFoundError("Policy document not found");return new Response(assignment.policyVersion.originalDocument,{headers:{"content-type":assignment.policyVersion.originalMimeType??"application/pdf","content-disposition":`inline; filename="${(assignment.policyVersion.originalFileName??"policy.pdf").replace(/[\"\\]/g,"_")}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}})}catch(error){return errorResponse(error)}
}
