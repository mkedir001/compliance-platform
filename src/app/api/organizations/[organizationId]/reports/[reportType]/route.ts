import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getRequirementEvidenceTrace } from "@/domain/audit/service";
import { getEmployeeComplianceReport, getEvidenceReport, getOrganizationComplianceReport, getPolicyReport, getRemediationReport, getServiceAssignmentReadinessReport, getTrainingReport, rowsToCsv } from "@/domain/reporting/service";

const reportTypeSchema = z.enum(["organization", "employee", "requirements", "training", "policies", "evidence", "remediation", "assignments"]);
const date = (value: string | null) => value ? new Date(value) : undefined;
const flat = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(item => item as Record<string, unknown>) : value && typeof value === "object" && "items" in value ? ((value as { items: Record<string, unknown>[] }).items) : [value as Record<string, unknown>];

export async function GET(request: Request, context: { params: Promise<{ organizationId: string; reportType: string }> }) {
  try {
    const user = await requireAuthenticatedUser(request), { organizationId, reportType: rawType } = await context.params, reportType = reportTypeSchema.parse(rawType), q = new URL(request.url).searchParams;
    const common = { employeeId: q.get("employeeId") ?? undefined, status: q.get("status") ?? undefined, from: date(q.get("from")), to: date(q.get("to")), page: q.get("page") ? Number(q.get("page")) : undefined, pageSize: q.get("pageSize") ? Number(q.get("pageSize")) : undefined, exportMode: q.get("format") === "csv" };
    let result: unknown;
    if (reportType === "organization") result = await getOrganizationComplianceReport(user, organizationId, { workforceStatus: q.get("workforceStatus") as never || undefined, at: date(q.get("at")) });
    else if (reportType === "employee") result = await getEmployeeComplianceReport(user, organizationId, z.string().cuid().parse(common.employeeId), date(q.get("at")));
    else if (reportType === "requirements") result = await getRequirementEvidenceTrace(user, organizationId, z.string().cuid().parse(q.get("requirementVersionId")), common.employeeId, q.get("at") ? { mode: "POINT_IN_TIME", at: date(q.get("at"))! } : { mode: "CURRENT" });
    else if (reportType === "training") result = await getTrainingReport(user, organizationId, { ...common, courseId: q.get("courseId") ?? undefined });
    else if (reportType === "policies") result = await getPolicyReport(user, organizationId, { ...common, policyId: q.get("policyId") ?? undefined, status: common.status });
    else if (reportType === "evidence") result = await getEvidenceReport(user, organizationId, common);
    else if (reportType === "remediation") result = await getRemediationReport(user, organizationId, { ...common, status: common.status as never });
    else result = await getServiceAssignmentReadinessReport(user, organizationId, common);
    if (q.get("format") === "csv") return new Response(rowsToCsv(flat(result)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${reportType}-report.csv"` } });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
