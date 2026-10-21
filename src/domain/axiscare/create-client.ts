import type { User } from "@prisma/client";
import { ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { createClient } from "@/domain/clients/service";
import { prisma } from "@/lib/prisma";
import { mapClientIdentity } from "./mapping";
import { confirmExplicitClientMatch } from "./sync";

/**
 * Creates a Waldah client from an unmatched AxisCare client using only its name and date of birth,
 * then links the two so the AxisCare visits attach to the new client. Everything else stays blank for intake.
 * Caller must hold billing.run; createClient itself enforces client.create and the duplicate (name + DOB) check.
 */
export async function createClientFromAxisCare(user: Pick<User, "id">, organizationId: string, axisCareClientId: string) {
  const source = await prisma.axisCareRecord.findUnique({ where: { organizationId_entity_externalId: { organizationId, entity: "client", externalId: axisCareClientId } }, select: { payload: true, removedAt: true, ignoredAt: true } });
  if (!source || source.removedAt || source.ignoredAt) throw new ResourceNotFoundError("AxisCare client not found");
  if (await prisma.client.findFirst({ where: { organizationId, axisCareClientId }, select: { id: true } })) throw new ConflictError("This AxisCare client is already matched to a Waldah client", "AXISCARE_CLIENT_ALREADY_MATCHED");
  const identity = mapClientIdentity(source.payload as Record<string, unknown>);
  if (!identity.firstName || !identity.lastName) throw new ValidationError("AxisCare has no first and last name for this client, so a Waldah client cannot be created from it");
  const dateOfBirth = identity.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(identity.dateOfBirth) ? identity.dateOfBirth.slice(0, 10) : null;
  const { client } = await createClient(user, organizationId, { legalFirstName: identity.firstName, legalLastName: identity.lastName, dateOfBirth: dateOfBirth ?? undefined });
  const linked = await confirmExplicitClientMatch(organizationId, axisCareClientId, client.id, user.id);
  if (!linked) throw new ConflictError("The Waldah client was created but could not be linked to AxisCare. Confirm the match manually.", "AXISCARE_LINK_FAILED");
  return client.id;
}
