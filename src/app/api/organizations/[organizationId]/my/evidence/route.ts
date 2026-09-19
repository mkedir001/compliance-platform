import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ResourceNotFoundError } from "@/domain/auth/errors";
import { getMyEvidenceOperations, submitCredentialForEmployee, submitExternalTrainingForEmployee } from "@/domain/evidence/operations";
import { prisma } from "@/lib/prisma";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{return Response.json(await getMyEvidenceOperations(await requireAuthenticatedUser(request),(await context.params).organizationId))}catch(error){return errorResponse(error)}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),organizationId=(await context.params).organizationId,employee=await prisma.employee.findFirst({where:{organizationId,userId:user.id},select:{id:true}});if(!employee)throw new ResourceNotFoundError("Employee self-service access required");const parsed=z.object({type:z.enum(["CREDENTIAL","EXTERNAL_TRAINING"]),input:z.unknown()}).parse(await request.json());return Response.json(parsed.type==="CREDENTIAL"?await submitCredentialForEmployee(user,organizationId,employee.id,parsed.input):await submitExternalTrainingForEmployee(user,organizationId,employee.id,parsed.input),{status:201})}catch(error){return errorResponse(error)}}
