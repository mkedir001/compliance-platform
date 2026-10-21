import { headers } from "next/headers";
import { PortalShell } from "@/app/components/portal-ui";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { listOrganizationUsers } from "@/domain/organization-users/service";
import { resolveAdminOrganizationIdWithPermission } from "../../organization-context";
import UsersPermissions from "./users-permissions";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const organizationId = await resolveAdminOrganizationIdWithPermission((await searchParams).organizationId ?? "", "user.read"), incoming = await headers();
  const user = await requireAuthenticatedUser(new Request(process.env.APP_BASE_URL ?? "http://localhost", { headers: Object.fromEntries(incoming.entries()) }));
  const initial = await listOrganizationUsers(user, organizationId);
  return <PortalShell organizationId={organizationId} current="Settings"><UsersPermissions organizationId={organizationId} initial={initial} /></PortalShell>;
}
