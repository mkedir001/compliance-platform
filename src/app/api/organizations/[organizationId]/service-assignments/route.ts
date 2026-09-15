import { z } from "zod";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { createServiceAssignment, evaluateProposedAssignment, listServiceAssignments } from "@/domain/service-assignments/service";

type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, url = new URL(request.url), status = url.searchParams.get("status"); return Response.json(await listServiceAssignments(user, organizationId, { status: status ? z.enum(["ACTIVE", "BLOCKED", "INACTIVE", "CANCELLED"]).parse(status) : undefined, medicationBlocked: url.searchParams.get("medicationBlocked") === "true", personSpecificBlocked: url.searchParams.get("personSpecificBlocked") === "true" })); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: Context) { try { const user = await requireAuthenticatedUser(request), { organizationId } = await context.params, body = await request.json(), action = z.enum(["EVALUATE", "CREATE"]).parse(body.action); return Response.json(action === "EVALUATE" ? await evaluateProposedAssignment(user, organizationId, body.assignment) : await createServiceAssignment(user, organizationId, body.assignment), { status: action === "CREATE" ? 201 : 200 }); } catch (error) { return errorResponse(error); } }
