import{z}from"zod";import{requireAuthenticatedUser}from"@/domain/auth/authentication";import{errorResponse}from"@/domain/auth/errors";import{bulkInviteEmployees}from"@/domain/workforce/import-service";
import{enforceRateLimit,requestRateKey}from"@/lib/rate-limit";
const schema=z.object({employeeIds:z.array(z.string().cuid()).min(1).max(100).refine(values=>new Set(values).size===values.length,"Employee IDs must be unique")}).strict();
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){
 try{
  const user=await requireAuthenticatedUser(request),{organizationId}=await context.params;await enforceRateLimit("bulk-invitations",requestRateKey(request,user.id),5,3600);const{employeeIds}=schema.parse(await request.json()),results=await bulkInviteEmployees(user,organizationId,employeeIds);
  return Response.json(results.map(result=>({employeeId:result.employeeId,status:result.status,...("reason" in result?{reason:result.reason}:{}),...("invitationId" in result?{invitationId:result.invitationId}:{})})));
 }catch(error){return errorResponse(error)}
}
