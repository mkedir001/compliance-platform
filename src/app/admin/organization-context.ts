import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { resolveAuthorizedAdminDestination } from "@/domain/auth/landing";

export async function resolveAdminOrganizationId(requestedOrganizationId = "") {
  const incoming = await headers();
  const request = new Request(process.env.APP_BASE_URL ?? "http://localhost", { headers: Object.fromEntries(incoming.entries()) });
  const user = await requireAuthenticatedUser(request);
  const destination = await resolveAuthorizedAdminDestination(user.id, requestedOrganizationId);
  if (!destination) redirect("/");
  return destination.organizationId;
}
