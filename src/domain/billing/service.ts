import type { User } from "@prisma/client";
import { requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export type BillingWorkspaceClient = {
  id: string;
  name: string;
  status: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  approvedHours: number | null;
};

export async function getBillingWorkspaceClients(user: Pick<User, "id">, organizationId: string): Promise<BillingWorkspaceClient[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "organization.manage");
  const rows = await prisma.client.findMany({
    where: { organizationId, archivedAt: null, testDataMarkedAt: null },
    select: {
      id: true,
      legalFirstName: true,
      legalLastName: true,
      status: true,
      services: { select: { startDate: true, authorizationStart: true, authorizationEnd: true, authorizedHours: true } },
    },
    orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
  });
  return rows.map(row => ({
    id: row.id,
    name: `${row.legalFirstName} ${row.legalLastName}`,
    status: row.status,
    serviceStart: row.services.map(service => (service.authorizationStart ?? service.startDate)?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    serviceEnd: row.services.map(service => service.authorizationEnd?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    approvedHours: row.services.some(service => service.authorizedHours !== null) ? row.services.reduce((sum, service) => sum + Number(service.authorizedHours ?? 0), 0) : null,
  }));
}
