import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getActionCenter } from "@/domain/action-center/service";

const category = z.enum(["TRAINING", "POLICY", "COMPETENCY", "EVIDENCE", "CREDENTIAL", "MEDICATION_CLINICAL", "SERVICE_ASSIGNMENT", "GENERAL_COMPLIANCE"]);
const status = z.enum(["OPEN", "IN_PROGRESS", "REVIEW_REQUIRED"]);
const deadlineState = z.enum(["OVERDUE", "DUE_SOON", "FUTURE", "NO_DEADLINE", "REQUIRES_REVIEW"]);
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) { try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, q = new URL(request.url).searchParams; return Response.json(await getActionCenter(user, organizationId, { search: q.get("search") ?? undefined, employeeId: q.get("employeeId") ?? undefined, category: q.get("category") ? category.parse(q.get("category")) : undefined, status: q.get("status") ? status.parse(q.get("status")) : undefined, deadlineState: q.get("deadlineState") ? deadlineState.parse(q.get("deadlineState")) : undefined, page: q.get("page") ? Number(q.get("page")) : undefined, pageSize: q.get("pageSize") ? Number(q.get("pageSize")) : undefined })); } catch (error) { return errorResponse(error); } }
