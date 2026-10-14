import { PortalShell } from "@/app/components/portal-ui";
import { resolveAdminOrganizationId } from "../../organization-context";
import TestDataCleanupPortal from "./test-data-cleanup-portal";

export default async function TestDataCleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const organizationId = await resolveAdminOrganizationId(
    (await searchParams).organizationId ?? "",
  );
  return (
    <PortalShell organizationId={organizationId} current="Settings">
      <TestDataCleanupPortal organizationId={organizationId} />
    </PortalShell>
  );
}
