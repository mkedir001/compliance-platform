import { redirect } from "next/navigation";
import { resolveAdminOrganizationId } from "../../organization-context";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ organizationId?: string; employeeTab?: string }> }) {
  const [{ employeeId }, { organizationId: requested = "", employeeTab = "" }] = await Promise.all([params, searchParams]);
  const organizationId = await resolveAdminOrganizationId(requested);
  const tab = employeeTab ? `&employeeTab=${encodeURIComponent(employeeTab)}` : "";
  redirect(`/admin/compliance-operations?organizationId=${encodeURIComponent(organizationId)}&view=employees&employeeId=${encodeURIComponent(employeeId)}${tab}`);
}
