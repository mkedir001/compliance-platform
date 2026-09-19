import{configuredEmailProvider}from"@/domain/notifications/email";
import{validateProductionEnvironment}from"@/lib/env";
import{prisma}from"@/lib/prisma";
export const dynamic="force-dynamic";
export async function GET(){try{if(process.env.NODE_ENV==="production")validateProductionEnvironment();await prisma.$queryRaw`SELECT 1`;return Response.json({status:"ready",database:"available",email:configuredEmailProvider().configured?"configured":"optional-unavailable"},{headers:{"cache-control":"no-store"}})}catch{return Response.json({status:"not-ready",database:"unavailable-or-misconfigured"},{status:503,headers:{"cache-control":"no-store"}})}}
