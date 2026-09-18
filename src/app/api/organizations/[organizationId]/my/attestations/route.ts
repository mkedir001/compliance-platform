import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { recordEmployeeAttestation } from "@/domain/portal/service";

const schema = z.object({ resourceType: z.string().startsWith("EMPLOYEE_").max(100), resourceId: z.string().min(1).max(255), statementVersion: z.string().min(1).max(100), statement: z.string().min(1).max(4000), typedName: z.string().min(1).max(200) });
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params; return Response.json(await recordEmployeeAttestation(user, organizationId, schema.parse(await request.json())), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
