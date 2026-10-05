import { redirect } from "next/navigation";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ organizationId?: string }> }) {
  const [{ employeeId }, { organizationId = "" }] = await Promise.all([params, searchParams]);
  redirect(`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}&view=employees&employeeId=${encodeURIComponent(employeeId)}`);
}
