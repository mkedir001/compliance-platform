import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse, ValidationError } from "@/domain/auth/errors";
import { advanceOwnerContent, getTrainingAssignmentDetail, saveOwnerAssessmentResponse, startOwnerAssessment, submitOwnerAssessment } from "@/domain/training/operations/service";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START_ASSESSMENT"), assessmentId: z.string().cuid() }).strict(),
  z.object({ action: z.literal("SAVE_RESPONSE"), attemptId: z.string().cuid(), questionId: z.string().cuid(), selectedOptionIds: z.array(z.string().cuid()).min(1) }).strict(),
  z.object({ action: z.literal("ADVANCE_CONTENT"), contentItemId: z.string().cuid() }).strict(),
  z.object({ action: z.literal("SUBMIT_ON_BEHALF"), attemptId: z.string().cuid(), confirmed: z.literal(true) }).strict(),
]);

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; assignmentId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), params = await context.params; return Response.json(await getTrainingAssignmentDetail(user, params.organizationId, params.assignmentId)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; assignmentId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), params = await context.params, input = inputSchema.parse(await request.json());
    if (input.action === "START_ASSESSMENT") return Response.json(await startOwnerAssessment(user, params.organizationId, params.assignmentId, input.assessmentId));
    if (input.action === "SAVE_RESPONSE") return Response.json(await saveOwnerAssessmentResponse(user, params.organizationId, params.assignmentId, input.attemptId, { questionId: input.questionId, selectedOptionIds: input.selectedOptionIds }));
    if (input.action === "ADVANCE_CONTENT") return Response.json(await advanceOwnerContent(user, params.organizationId, params.assignmentId, input.contentItemId));
    if (input.action === "SUBMIT_ON_BEHALF") return Response.json(await submitOwnerAssessment(user, params.organizationId, params.assignmentId, input.attemptId));
    throw new ValidationError("Unsupported training-assistance action");
  } catch (error) { return errorResponse(error); }
}
