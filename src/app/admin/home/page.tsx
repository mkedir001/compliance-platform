import { redirect } from "next/navigation";
import { resolveAdminOrganizationId } from "../organization-context";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const requested = (await searchParams).organizationId ?? "";
  const organizationId = await resolveAdminOrganizationId(requested);
  redirect(`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}`);
}
