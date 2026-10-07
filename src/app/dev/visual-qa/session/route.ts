import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEVELOPMENT_VISUAL_QA_COOKIE } from "@/domain/auth/authentication";
import { DEVELOPMENT_VISUAL_QA_OWNER_EMAIL, developmentVisualQaMode, resolveDevelopmentVisualQaLanding } from "@/domain/auth/development-visual-qa";

export async function POST(request: Request) {
  if (!developmentVisualQaMode()) return Response.json({error:"Not found"},{status:404});
  const user=await prisma.user.findFirst({where:{email:DEVELOPMENT_VISUAL_QA_OWNER_EMAIL,status:"ACTIVE"}});
  if(!user) return Response.json({error:"Run the development seed before starting visual QA."},{status:409});
  const destination=await resolveDevelopmentVisualQaLanding(user.id);
  if(!destination) return Response.json({error:"The seeded visual-QA owner has no authorized organization workspace."},{status:409});
  const response=NextResponse.redirect(new URL(destination.href,request.url),303);
  response.cookies.set(DEVELOPMENT_VISUAL_QA_COOKIE,user.id,{httpOnly:true,sameSite:"strict",path:"/",maxAge:8*60*60,secure:false});
  return response;
}
