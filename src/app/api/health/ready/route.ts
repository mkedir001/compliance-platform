import{configuredEmailProvider}from"@/domain/notifications/email";
import{probeEvidenceStorage}from"@/lib/evidence-storage";
import{validateProductionEnvironment}from"@/lib/env";
import{prisma}from"@/lib/prisma";
import{probeRateLimiter}from"@/lib/rate-limit";
export const dynamic="force-dynamic";
export async function GET(){try{if(process.env.NODE_ENV==="production")validateProductionEnvironment();await Promise.all([prisma.$queryRaw`SELECT 1`,probeRateLimiter(),probeEvidenceStorage()]);return Response.json({status:"ready",database:"available",rateLimiter:"available",evidenceStorage:"available",email:configuredEmailProvider().configured?"configured":"optional-unavailable"},{headers:{"cache-control":"no-store"}})}catch{return Response.json({status:"not-ready",requiredInfrastructure:"unavailable-or-misconfigured"},{status:503,headers:{"cache-control":"no-store"}})}}
