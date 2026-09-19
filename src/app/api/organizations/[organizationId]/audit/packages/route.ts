import type { AuditPackageScope } from "@prisma/client";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createAuditPackage } from "@/domain/audit/service";
import { listAuditPackages } from "@/domain/reporting/service";

const inputSchema = z.object({ scope: z.enum(["EMPLOYEE_COMPLIANCE_RECORD", "REQUIREMENT_EVIDENCE_RECORD", "ORGANIZATION_COMPLIANCE_SUMMARY"]), subjectId: z.string().cuid().optional(), pointInTimeAt: z.coerce.date().optional(), rangeFrom: z.coerce.date().optional(), rangeTo: z.coerce.date().optional(), includedDomains: z.array(z.enum(["WORKFORCE", "TRAINING", "POLICIES", "EVIDENCE", "REMEDIATION", "ASSIGNMENTS", "NOTIFICATIONS", "AUDIT_HISTORY"])).max(8).optional() }).strict();

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, q = new URL(request.url).searchParams; return Response.json(await listAuditPackages(user, organizationId, { page: q.get("page") ? Number(q.get("page")) : undefined, pageSize: q.get("pageSize") ? Number(q.get("pageSize")) : undefined })); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = inputSchema.parse(await request.json()) as Parameters<typeof createAuditPackage>[2] & { scope: AuditPackageScope };
    return Response.json(await createAuditPackage(user, organizationId, body), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
