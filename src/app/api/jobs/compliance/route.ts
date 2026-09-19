import{timingSafeEqual}from"node:crypto";
import{z}from"zod";
import{errorResponse,AuthenticationError}from"@/domain/auth/errors";
import{reconcileOrganizationIssues}from"@/domain/compliance-issues/service";
import{configuredEmailProvider}from"@/domain/notifications/email";
import{processEmailDeliveries,reconcileOrganizationNotifications}from"@/domain/notifications/service";
import{validateProductionEnvironment}from"@/lib/env";
import{recordOperationalEvent}from"@/lib/observability";
import{prisma}from"@/lib/prisma";
function authorized(request:Request,secret:string){const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"",a=Buffer.from(token),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b)}
export async function POST(request:Request){let organizationId:string|undefined;try{const config=validateProductionEnvironment(),body=z.object({organizationId:z.string().cuid()}).strict().parse(await request.json());organizationId=body.organizationId;if(!authorized(request,config.JOB_SECRET))throw new AuthenticationError("Job authentication required");const actor=await prisma.user.findFirst({where:{id:config.JOB_ACTOR_USER_ID,status:"ACTIVE"}});if(!actor)throw new AuthenticationError("Configured job actor is unavailable");const issues=await reconcileOrganizationIssues(actor,organizationId),notifications=await reconcileOrganizationNotifications(actor,organizationId),email=await processEmailDeliveries(organizationId,configuredEmailProvider(),new Date(),100);await recordOperationalEvent({level:"info",operation:"compliance.job.completed",organizationId,actorUserId:actor.id});return Response.json({organizationId,issues:{employeesScanned:issues.employeesScanned,detected:issues.detected,resolved:issues.resolved},notifications,email:{processed:email.processed}})}catch(error){await recordOperationalEvent({level:"error",operation:"compliance.job.failed",organizationId,errorName:error instanceof Error?error.name:"UnknownError",message:"Compliance job failed"});return errorResponse(error)}}
