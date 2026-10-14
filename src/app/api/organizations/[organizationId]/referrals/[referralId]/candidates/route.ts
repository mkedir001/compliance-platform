import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { searchReferralClientCandidates } from "@/domain/referrals/service";

export async function GET(request:Request,context:{params:Promise<{organizationId:string;referralId:string}>}){
  try{
    const user=await requireAuthenticatedUser(request),{organizationId,referralId}=await context.params,query=new URL(request.url).searchParams;
    return Response.json(await searchReferralClientCandidates(user,organizationId,referralId,{search:query.get("search")??"",page:Number(query.get("page")??1),pageSize:Number(query.get("pageSize")??10)}));
  }catch(error){return errorResponse(error)}
}
