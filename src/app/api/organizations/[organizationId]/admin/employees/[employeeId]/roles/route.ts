import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { mutateOrganizationRole } from "@/domain/workforce-administration/service";
export async function POST(request:Request,context:{params:Promise<{organizationId:string;employeeId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId,employeeId}=await context.params,body=z.object({roleDefinitionId:z.string().cuid(),action:z.enum(["GRANT","REVOKE"])}).parse(await request.json());return Response.json(await mutateOrganizationRole(user,organizationId,employeeId,body.roleDefinitionId,body.action))}catch(error){return errorResponse(error)}}
