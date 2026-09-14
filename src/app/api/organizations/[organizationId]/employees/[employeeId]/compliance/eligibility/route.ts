import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { evaluateServiceEligibility } from "@/domain/compliance/operations/service";

const inputSchema = z.object({ scope: z.enum(["GENERAL_WORK", "DIRECT_CONTACT", "UNSUPERVISED_CONTACT", "PERSON_SPECIFIC_TASK", "MEDICATION_ADMINISTRATION"]) });
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request), params = await context.params, input = inputSchema.parse(await request.json()); return Response.json(await evaluateServiceEligibility(user, params.organizationId, params.employeeId, input.scope)); } catch (error) { return errorResponse(error); } }
