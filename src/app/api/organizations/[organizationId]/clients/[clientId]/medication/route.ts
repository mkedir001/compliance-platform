import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { applyMedicationAction, getMedicationRecord } from "@/domain/clients/medication-mar";
import { todayKey } from "@/domain/clients/mar";

type Context = { params: Promise<{ organizationId: string; clientId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), p = await context.params, month = new URL(request.url).searchParams.get("month") ?? todayKey().slice(0, 7);
    return Response.json(await getMedicationRecord(user, p.organizationId, p.clientId, month));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireAuthenticatedUser(request), p = await context.params;
    return Response.json(await applyMedicationAction(user, p.organizationId, p.clientId, await request.json()));
  } catch (error) { return errorResponse(error); }
}
