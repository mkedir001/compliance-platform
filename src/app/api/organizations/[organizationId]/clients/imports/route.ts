import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { cancelClientImport, classifyClientImportDocument, confirmClientImport, createClientImport, getClientImport, listClientImports, reviewClientImportProposal } from "@/domain/clients/imports";

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("CREATE"),requestId:z.string().uuid().optional(),target:z.enum(["CREATE_NEW","UPDATE_EXISTING"]),existingClientId:z.string().cuid().optional(),files:z.array(z.object({fileName:z.string(),mimeType:z.literal("application/pdf"),pdfBase64:z.string()}))}),
  z.object({action:z.literal("REVIEW"),sessionId:z.string().cuid(),proposalId:z.string().cuid(),state:z.enum(["ACCEPTED","CORRECTED","REJECTED"]),correctedValue:z.union([z.string(),z.number(),z.boolean(),z.array(z.string())]).optional()}),
  z.object({action:z.literal("CLASSIFY"),sessionId:z.string().cuid(),documentId:z.string().cuid(),classification:z.enum(["INTAKE_CHECKLIST","FACE_SHEET","RIGHTS_ACKNOWLEDGMENT","ROI","UNKNOWN"])}),
  z.object({action:z.literal("CONFIRM"),sessionId:z.string().cuid(),confirmed:z.literal(true),target:z.enum(["CREATE_NEW","UPDATE_EXISTING"]),clientId:z.string().cuid().optional(),documents:z.array(z.object({documentId:z.string().cuid(),disposition:z.enum(["PRESERVE_ONLY","HISTORICAL_COMPLETE","CURRENT_SIGNATURE_REQUIRED"]),completedAt:z.coerce.date().optional()}))}),
  z.object({action:z.literal("CANCEL"),sessionId:z.string().cuid()}),
]);

export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params,query=new URL(request.url).searchParams,sessionId=query.get("sessionId"),clientId=query.get("clientId");return Response.json(sessionId?await getClientImport(user,organizationId,sessionId):await listClientImports(user,organizationId,clientId??undefined))}catch(error){return errorResponse(error)}}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){try{const user=await requireAuthenticatedUser(request),{organizationId}=await context.params,body=actionSchema.parse(await request.json());if(body.action==="CREATE")return Response.json(await createClientImport(user,organizationId,body),{status:201});if(body.action==="REVIEW")return Response.json(await reviewClientImportProposal(user,organizationId,body.sessionId,body));if(body.action==="CLASSIFY")return Response.json(await classifyClientImportDocument(user,organizationId,body.sessionId,body.documentId,body.classification));if(body.action==="CONFIRM")return Response.json(await confirmClientImport(user,organizationId,body.sessionId,body));return Response.json(await cancelClientImport(user,organizationId,body.sessionId))}catch(error){return errorResponse(error)}}
