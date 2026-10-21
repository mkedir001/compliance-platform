import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { AuthorizationError, errorResponse } from "@/domain/auth/errors";
import { applyMedicationAction, getMedicationRecord, recordMedicationAuthorizationFailure } from "@/domain/clients/medication-mar";
import { todayKey } from "@/domain/clients/mar";

type Context = { params: Promise<{ organizationId: string; clientId: string }> };

export async function GET(request: Request, context: Context) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>> | undefined, p: Awaited<Context["params"]> | undefined;
  try {
    user = await requireAuthenticatedUser(request); p = await context.params; const month = new URL(request.url).searchParams.get("month") ?? todayKey().slice(0, 7);
    return Response.json(await getMedicationRecord(user, p.organizationId, p.clientId, month));
  } catch (error) { if (error instanceof AuthorizationError && user && p) try { await recordMedicationAuthorizationFailure(user.id, p.organizationId, p.clientId, "READ"); } catch { /* Preserve the original fail-closed denial if audit storage is unavailable. */ } return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>> | undefined, p: Awaited<Context["params"]> | undefined;
  try {
    user = await requireAuthenticatedUser(request); p = await context.params;
    return Response.json(await applyMedicationAction(user, p.organizationId, p.clientId, await request.json()));
  } catch (error) { if (error instanceof AuthorizationError && user && p) try { await recordMedicationAuthorizationFailure(user.id, p.organizationId, p.clientId, "WRITE"); } catch { /* Preserve the original fail-closed denial if audit storage is unavailable. */ } return errorResponse(error); }
}
