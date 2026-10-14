import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { resolveAuthorizedAdminDestination } from "@/domain/auth/landing";
import { requireOrganizationMembership, resolvePermissionCodes } from "@/domain/permissions/authorization";

async function authenticatedAdminDestination(requestedOrganizationId = "") {
  const incoming = await headers();
  const request = new Request(process.env.APP_BASE_URL ?? "http://localhost", { headers: Object.fromEntries(incoming.entries()) });
  const user = await requireAuthenticatedUser(request);
  const destination = await resolveAuthorizedAdminDestination(user.id, requestedOrganizationId);
  if (!destination) redirect("/");
  return { destination, user };
}

export async function resolveAdminOrganizationId(requestedOrganizationId = "") {
  const { destination } = await authenticatedAdminDestination(requestedOrganizationId);
  return destination.organizationId;
}

export async function resolveAdminOrganizationIdWithPermission(requestedOrganizationId: string, permission: string) {
  const { destination, user } = await authenticatedAdminDestination(requestedOrganizationId);
  const membership = await requireOrganizationMembership(user.id, destination.organizationId);
  if (!(await resolvePermissionCodes(membership.id)).has(permission)) redirect("/");
  return destination.organizationId;
}
