import { PortalShell } from "@/app/components/portal-ui";
import { resolveAdminOrganizationIdWithPermission } from "../../organization-context";
import TestDataCleanupPortal from "./test-data-cleanup-portal";

export default async function TestDataCleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const organizationId = await resolveAdminOrganizationIdWithPermission(
    (await searchParams).organizationId ?? "",
    "organization.manage",
  );
  return (
    <PortalShell organizationId={organizationId} current="Settings">
      <TestDataCleanupPortal organizationId={organizationId} />
    </PortalShell>
  );
}
