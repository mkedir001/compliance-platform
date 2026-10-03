import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getFacilitatedSigningReturn } from "@/domain/clients/signatures";

export async function GET(request:Request,context:{params:Promise<{token:string}>}){
  try{
    const user=await requireAuthenticatedUser(request),{token}=await context.params,path=await getFacilitatedSigningReturn(user,token);
    return Response.redirect(new URL(path,request.url),303);
  }catch(error){return errorResponse(error)}
}
