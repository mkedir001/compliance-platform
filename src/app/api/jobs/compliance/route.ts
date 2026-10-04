import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthenticationError, ValidationError, errorResponse } from "@/domain/auth/errors";
import { reconcileOrganizationIssues } from "@/domain/compliance-issues/service";
import { configuredEmailProviderForPurpose } from "@/domain/notifications/email";
import { processEmailDeliveries, reconcileOrganizationNotifications } from "@/domain/notifications/service";
import { validateProductionEnvironment } from "@/lib/env";
import { recordOperationalEvent } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

function authorized(request: Request, secret: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const received = Buffer.from(token), expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  let organizationId: string | undefined;
  try {
    let config;
    try { config = validateProductionEnvironment(); } catch { throw new Error("Production job configuration unavailable"); }
    if (!authorized(request, config.JOB_SECRET)) throw new AuthenticationError("Job authentication required");
    const body = z.object({ organizationId: z.string().cuid() }).strict().parse(await request.json());
    organizationId = body.organizationId;
    const actor = await prisma.user.findFirst({ where: { id: config.JOB_ACTOR_USER_ID, status: "ACTIVE" } });
    if (!actor) throw new AuthenticationError("Configured job actor is unavailable");
    const result = await prisma.$transaction(async transaction => {
      const [lock] = await transaction.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`compliance-job:${organizationId}`})) AS locked`;
      if (!lock?.locked) throw new ValidationError("Compliance job is already running for this organization");
      const issues = await reconcileOrganizationIssues(actor, organizationId!);
      const notifications = await reconcileOrganizationNotifications(actor, organizationId!);
      const email = await processEmailDeliveries(organizationId!, configuredEmailProviderForPurpose("WORKFORCE_TRANSACTIONAL"), new Date(), 100);
      return { issues, notifications, email };
    }, { timeout: 120_000 });
    await recordOperationalEvent({ level: "info", operation: "compliance.job.completed", organizationId, actorUserId: actor.id });
    return Response.json({ organizationId, issues: { employeesScanned: result.issues.employeesScanned, detected: result.issues.detected, resolved: result.issues.resolved }, notifications: result.notifications, email: { processed: result.email.processed } });
  } catch (error) {
    await recordOperationalEvent({ level: "error", operation: "compliance.job.failed", organizationId, errorName: error instanceof Error ? error.name : "UnknownError", message: "Compliance job failed" });
    return errorResponse(error);
  }
}
