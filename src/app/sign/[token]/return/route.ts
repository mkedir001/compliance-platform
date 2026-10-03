import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getFacilitatedSigningReturn } from "@/domain/clients/signatures";

export async function GET(request:Request,context:{params:Promise<{token:string}>}){
  try{
    const user=await requireAuthenticatedUser(request),{token}=await context.params,path=await getFacilitatedSigningReturn(user,token);
    return new Response(null,{status:303,headers:{location:path,"cache-control":"no-store","referrer-policy":"no-referrer"}});
  }catch(error){return errorResponse(error)}
}
