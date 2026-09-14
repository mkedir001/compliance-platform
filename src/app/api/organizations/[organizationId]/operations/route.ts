import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getComplianceOperationsSummary } from "@/domain/operations/service";

const statusSchema = z.enum(["READY", "NOT_READY", "ACTION_REQUIRED", "EXPIRING_SOON", "OVERDUE", "BLOCKED"]);
const scopeSchema = z.enum(["GENERAL_WORK", "DIRECT_CONTACT", "UNSUPERVISED_CONTACT", "PERSON_SPECIFIC_TASK", "MEDICATION_ADMINISTRATION"]);
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, url = new URL(request.url);
    const status = url.searchParams.get("status"), scope = url.searchParams.get("scope");
    return Response.json(await getComplianceOperationsSummary(user, organizationId, new Date(), { status: status ? statusSchema.parse(status) : undefined, scope: scope ? scopeSchema.parse(scope) : undefined }));
  } catch (error) {
    return errorResponse(error);
  }
}
