import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { assignBaselineTraining, getEmployeeTrainingReadiness, initializePersonSpecificTraining, updateFirstAidReadiness, updateMedicationReadiness } from "@/domain/workforce/training-readiness";

type Context = { params: Promise<{ organizationId: string; employeeId: string }> };

export async function GET(request: Request, context: Context) {
  try { const user = await requireAuthenticatedUser(request), params = await context.params; return Response.json(await getEmployeeTrainingReadiness(user, params.organizationId, params.employeeId)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), params = await context.params, body = await request.json(), action = z.enum(["ASSIGN_BASELINE", "FIRST_AID", "MEDICATION", "ASSIGN_PERSON_SPECIFIC"]).parse(body.action);
    if (action === "ASSIGN_BASELINE") return Response.json(await assignBaselineTraining(user, params.organizationId, params.employeeId, body.payload), { status: 201 });
    if (action === "FIRST_AID") return Response.json(await updateFirstAidReadiness(user, params.organizationId, params.employeeId, body.payload));
    if (action === "MEDICATION") return Response.json(await updateMedicationReadiness(user, params.organizationId, params.employeeId, body.payload));
    return Response.json(await initializePersonSpecificTraining(user, params.organizationId, params.employeeId, body.payload), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
