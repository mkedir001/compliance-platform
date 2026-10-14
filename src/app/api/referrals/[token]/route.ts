import { z } from "zod";
import { errorResponse } from "@/domain/auth/errors";
import { enforceRateLimit, requestRateKey } from "@/lib/rate-limit";
import { getPublicReferral, savePublicReferralDraft, submitPublicReferral } from "@/domain/referrals/service";
const headers={"cache-control":"no-store, private","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
function unavailable(){return Response.json({error:"Referral form is invalid or unavailable"},{status:404,headers})}
export async function GET(request:Request,context:{params:Promise<{token:string}>}){try{await enforceRateLimit("public-referral-view",requestRateKey(request),60,3600);return Response.json(await getPublicReferral((await context.params).token),{headers})}catch{return unavailable()}}
export async function POST(request:Request,context:{params:Promise<{token:string}>}){try{await enforceRateLimit("public-referral-write",requestRateKey(request),20,3600);const body=z.object({action:z.enum(["SAVE","SUBMIT"]),answers:z.unknown(),idempotencyKey:z.string().uuid().optional()}).parse(await request.json()),token=(await context.params).token;return Response.json(body.action==="SAVE"?await savePublicReferralDraft(token,body.answers):await submitPublicReferral(token,{answers:body.answers,idempotencyKey:z.string().uuid().parse(body.idempotencyKey)}),{headers})}catch(error){const response=errorResponse(error);response.headers.set("cache-control","no-store, private");response.headers.set("referrer-policy","no-referrer");return response.status===404?unavailable():response}}
