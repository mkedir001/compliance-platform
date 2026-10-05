import { redirect } from "next/navigation";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const { organizationId = "" } = await searchParams;
  redirect(`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}&view=employees`);
}
