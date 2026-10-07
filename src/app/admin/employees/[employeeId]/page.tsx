import { redirect } from "next/navigation";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ organizationId?: string; employeeTab?: string }> }) {
  const [{ employeeId }, { organizationId = "", employeeTab = "" }] = await Promise.all([params, searchParams]);
  const tab = employeeTab ? `&employeeTab=${encodeURIComponent(employeeTab)}` : "";
  redirect(`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}&view=employees&employeeId=${encodeURIComponent(employeeId)}${tab}`);
}
