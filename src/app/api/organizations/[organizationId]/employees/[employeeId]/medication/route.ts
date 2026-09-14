import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import {
  createMedicationObservedAssessment,
  assignMedicationTraining,
  evaluateMedicationDutyEligibility,
  finalizeMedicationObservedAssessment,
  getMedicationEvidence,
  getMedicationQualification,
  listMedicationQualifications,
  recordMedicationAuthorization,
  recordPersonSpecificInstruction,
  signoffMedicationQualification,
} from "@/domain/medication/service";

const actionSchema = z.object({ action: z.enum(["ASSIGN_TRAINING", "CREATE_OBSERVED_ASSESSMENT", "FINALIZE_OBSERVED_ASSESSMENT", "CLINICAL_SIGNOFF", "RECORD_PERSON_INSTRUCTION", "RECORD_AUTHORIZATION", "EVALUATE_ELIGIBILITY"]), assessmentId: z.string().cuid().optional(), payload: z.unknown() });

type Context = { params: Promise<{ organizationId: string; employeeId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params;
    const url = new URL(request.url), pathwayId = url.searchParams.get("pathwayId"), evidence = url.searchParams.get("evidence") === "true";
    if (evidence) return Response.json(await getMedicationEvidence(user, organizationId, employeeId));
    return Response.json(pathwayId ? await getMedicationQualification(user, organizationId, employeeId, pathwayId) : await listMedicationQualifications(user, organizationId, employeeId));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, employeeId } = await context.params, input = actionSchema.parse(await request.json());
    if (input.action === "ASSIGN_TRAINING") return Response.json(await assignMedicationTraining(user, organizationId, employeeId, z.object({ pathwayId: z.string().cuid() }).parse(input.payload).pathwayId), { status: 201 });
    if (input.action === "CREATE_OBSERVED_ASSESSMENT") return Response.json(await createMedicationObservedAssessment(user, organizationId, employeeId, input.payload), { status: 201 });
    if (input.action === "FINALIZE_OBSERVED_ASSESSMENT") {
      if (!input.assessmentId) throw new Error("assessmentId is required");
      return Response.json(await finalizeMedicationObservedAssessment(user, organizationId, input.assessmentId, input.payload));
    }
    if (input.action === "CLINICAL_SIGNOFF") return Response.json(await signoffMedicationQualification(user, organizationId, employeeId, input.payload), { status: 201 });
    if (input.action === "RECORD_PERSON_INSTRUCTION") return Response.json(await recordPersonSpecificInstruction(user, organizationId, employeeId, input.payload), { status: 201 });
    if (input.action === "RECORD_AUTHORIZATION") return Response.json(await recordMedicationAuthorization(user, organizationId, employeeId, input.payload), { status: 201 });
    const payload = z.object({ pathwayId: z.string().cuid(), serviceRecipientRef: z.string().max(255).optional() }).parse(input.payload);
    return Response.json(await evaluateMedicationDutyEligibility(user, organizationId, employeeId, payload.pathwayId, payload.serviceRecipientRef));
  } catch (error) { return errorResponse(error); }
}
