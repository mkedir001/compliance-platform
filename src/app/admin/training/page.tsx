import TrainingCatalog from "./training-catalog";
import { resolveAdminOrganizationId } from "../organization-context";

export default async function AdminTraining({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const requested = (await searchParams).organizationId ?? "";
  return <TrainingCatalog organizationId={await resolveAdminOrganizationId(requested)} />;
}
