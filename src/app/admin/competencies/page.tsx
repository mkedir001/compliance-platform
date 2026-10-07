import Competencies from "./competencies";
import { resolveAdminOrganizationId } from "../organization-context";

export default async function CompetenciesPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const requested = (await searchParams).organizationId ?? "";
  return <Competencies organizationId={await resolveAdminOrganizationId(requested)} />;
}
