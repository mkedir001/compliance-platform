import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/domain/permissions/authorization";

export const operationalClientWhere: Prisma.ClientWhereInput = { testDataMarkedAt: null };
export const operationalEmployeeWhere: Prisma.EmployeeWhereInput = { testDataMarkedAt: null };

export async function authorizeTestDataInclusion(membershipId: string, requested = false) {
  if (requested) await requirePermission(membershipId, "organization.manage");
  return requested;
}
