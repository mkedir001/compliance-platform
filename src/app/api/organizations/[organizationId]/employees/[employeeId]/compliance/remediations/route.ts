import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { executeRemediation } from "@/domain/compliance/operations/service";

const inputSchema = z.object({ complianceInstanceId: z.string().cuid(), remediationType: z.enum(["ASSIGN_REQUIRED_TRAINING", "RESUME_INCOMPLETE_TRAINING", "RETAKE_FAILED_ASSESSMENT", "COMPLETE_COMPETENCY_ASSESSMENT", "OBTAIN_ASSESSOR_SIGN_OFF", "RENEW_EXPIRED_CREDENTIAL", "UPLOAD_VERIFY_EXTERNAL_EVIDENCE", "ACKNOWLEDGE_REQUIRED_POLICY", "COMPLETE_ONBOARDING_STEP", "OBTAIN_REQUIRED_ATTESTATION", "OBTAIN_MEDICATION_COMPETENCY_EVIDENCE"]) });
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; employeeId: string }> }) { try { const user = await requireAuthenticatedUser(request), params = await context.params, input = inputSchema.parse(await request.json()); return Response.json(await executeRemediation(user, params.organizationId, params.employeeId, input.complianceInstanceId, input.remediationType)); } catch (error) { return errorResponse(error); } }
