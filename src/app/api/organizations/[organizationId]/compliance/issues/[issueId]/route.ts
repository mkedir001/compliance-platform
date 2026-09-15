import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { getComplianceIssue, startIssueRemediation } from "@/domain/compliance-issues/service";

type Context = { params: Promise<{ organizationId: string; issueId: string }> };
export async function GET(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), { organizationId, issueId } = await context.params; return Response.json(await getComplianceIssue(user, organizationId, issueId)); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), { organizationId, issueId } = await context.params, action = z.literal("START_REMEDIATION").parse((await request.json()).action); void action; return Response.json(await startIssueRemediation(user, organizationId, issueId)); } catch (error) { return errorResponse(error); } }
