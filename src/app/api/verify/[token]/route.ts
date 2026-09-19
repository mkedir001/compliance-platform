import { verifyCertificate } from "@/domain/evidence/service";
import { errorResponse } from "@/domain/auth/errors";
import { enforceRateLimit,requestRateKey } from "@/lib/rate-limit";
export async function GET(request:Request,c:{params:Promise<{token:string}>}){try{await enforceRateLimit("certificate-verification",requestRateKey(request),60,60);const token=(await c.params).token;if(token.length>256)return Response.json({valid:false},{status:404});const value=await verifyCertificate(token);return value?Response.json(value):Response.json({valid:false},{status:404})}catch(error){return errorResponse(error)}}
