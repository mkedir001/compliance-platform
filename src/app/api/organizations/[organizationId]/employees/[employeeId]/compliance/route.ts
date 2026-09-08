import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { requireEmployeeAccess } from "@/domain/permissions/authorization";
import { evaluateEmployeeCompliance } from "@/domain/compliance/evaluation/service";
import { prisma } from "@/lib/prisma";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;employeeId:string}>}){try{const user=await requireAuthenticatedUser(request),p=await context.params;await requireEmployeeAccess(user,p.organizationId,p.employeeId,"employee.read");return Response.json(await prisma.complianceInstance.findMany({where:{organizationId:p.organizationId,employeeId:p.employeeId},include:{requirementVersion:{include:{requirement:true}},ruleset:true},orderBy:{createdAt:"desc"}}));}catch(error){return errorResponse(error)}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string;employeeId:string}>}){try{const user=await requireAuthenticatedUser(request),p=await context.params;await requireEmployeeAccess(user,p.organizationId,p.employeeId,"employee.manage");return Response.json(await evaluateEmployeeCompliance(p.organizationId,p.employeeId,"MANUAL"));}catch(error){return errorResponse(error)}}
