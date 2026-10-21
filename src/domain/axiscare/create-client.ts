import { Prisma, type User } from "@prisma/client";
import { ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { clientIntakeChecklistDefinitions } from "@/domain/clients/service";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";
import { mapClientIdentity } from "./mapping";

const requestKey = (axisCareClientId: string) => `axiscare:${axisCareClientId}`;
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);

/** Creates an intake-in-progress client and claims its AxisCare identity atomically. */
export async function createClientFromAxisCare(user: Pick<User, "id">, organizationId: string, axisCareClientId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "billing.run");
  await requirePermission(membership.id, "client.create");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const source = await tx.axisCareRecord.findUnique({
          where: { organizationId_entity_externalId: { organizationId, entity: "client", externalId: axisCareClientId } },
          select: { payload: true, removedAt: true, ignoredAt: true },
        });
        if (!source || source.removedAt || source.ignoredAt) throw new ResourceNotFoundError("AxisCare client not found");

        const existingClaim = await tx.client.findFirst({ where: { organizationId, axisCareClientId }, select: { id: true } });
        if (existingClaim) return existingClaim.id;

        const identity = mapClientIdentity(source.payload as Record<string, unknown>);
        if (!identity.firstName || !identity.lastName) throw new ValidationError("AxisCare has no first and last name for this client, so a Waldah client cannot be created from it");
        const dateOfBirth = identity.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(identity.dateOfBirth) ? new Date(`${identity.dateOfBirth.slice(0, 10)}T00:00:00.000Z`) : null;
        const creationRequestId = requestKey(axisCareClientId);
        let client = await tx.client.findUnique({ where: { organizationId_creationRequestId: { organizationId, creationRequestId } }, select: { id: true, axisCareClientId: true } });

        if (client?.axisCareClientId && client.axisCareClientId !== axisCareClientId) throw new ConflictError("The reviewed AxisCare client conflicts with an existing external mapping", "AXISCARE_CLIENT_ALREADY_MATCHED");
        if (!client) {
          const [suggested, possibleDuplicate] = await Promise.all([
            tx.axisCareClientMatch.findFirst({ where: { organizationId, axisCareClientId, status: "SUGGESTED", clientId: { not: null } }, select: { id: true } }),
            tx.client.findFirst({ where: { organizationId, archivedAt: null, legalFirstName: { equals: identity.firstName, mode: "insensitive" }, legalLastName: { equals: identity.lastName, mode: "insensitive" } }, select: { id: true } }),
          ]);
          if (suggested || possibleDuplicate) throw new ConflictError("A possible Waldah client already exists. Review and confirm that match instead of creating another client.", "POSSIBLE_DUPLICATE_CLIENT");
          client = await tx.client.create({
            data: { organizationId, createdByUserId: user.id, legalFirstName: identity.firstName, legalLastName: identity.lastName, dateOfBirth, status: "INTAKE_IN_PROGRESS", creationRequestId },
            select: { id: true, axisCareClientId: true },
          });
          const intake = await tx.clientIntake.create({
            data: { organizationId, clientId: client.id, status: "IN_PROGRESS", checklistItems: { create: clientIntakeChecklistDefinitions.map(([code, label], index) => ({ code, label, sequence: index + 1 })) } },
            select: { id: true },
          });
          await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "client.created_from_axiscare", entityType: "Client", entityId: client.id, metadataJson: { intakeId: intake.id, source: "AXISCARE_REVIEW" } } });
        }

        const match = await tx.axisCareClientMatch.upsert({
          where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId, clientId: client.id } },
          create: { organizationId, axisCareClientId, clientId: client.id, status: "CONFIRMED", score: 0, reason: "Created from reviewed AxisCare identity", decidedByUserId: user.id, decidedAt: new Date() },
          update: { status: "CONFIRMED", score: 0, reason: "Created from reviewed AxisCare identity", decidedByUserId: user.id, decidedAt: new Date() },
          select: { id: true },
        });
        const claimed = await tx.client.updateMany({ where: { id: client.id, organizationId, OR: [{ axisCareClientId: null }, { axisCareClientId }] }, data: { axisCareClientId } });
        if (claimed.count !== 1) throw new ConflictError("The Waldah client could not be linked because its mapping changed. Refresh and review the current record.", "WALDAH_CLIENT_ALREADY_MATCHED");
        await tx.axisCareClientMatch.updateMany({ where: { organizationId, status: "SUGGESTED", id: { not: match.id }, OR: [{ axisCareClientId }, { clientId: client.id }] }, data: { status: "REJECTED", decidedByUserId: user.id, decidedAt: new Date() } });
        await tx.axisCareVisit.updateMany({ where: { organizationId, axisCareClientId, clientId: null }, data: { clientId: client.id } });
        await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "axiscare.client_created_and_mapped", entityType: "Client", entityId: client.id, metadataJson: { source: "AXISCARE_REVIEW" } } });
        return client.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("The client could not be created because the matching state changed. Refresh and try again.", "AXISCARE_CREATION_CONFLICT");
}
