import type { User } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { mapClientIdentity } from "@/domain/axiscare/mapping";
import { requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { classifyEvv, roundMoneyCents, type EvvReason } from "./evv";
import { prisma } from "@/lib/prisma";

export type BillingWorkspaceClient = {
  id: string;
  name: string;
  status: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  approvedHours: number | null;
  axisCareLinked: boolean;
};

export async function getBillingWorkspaceClients(user: Pick<User, "id">, organizationId: string): Promise<BillingWorkspaceClient[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const codes = await resolvePermissionCodes(membership.id);
  if (!codes.has("billing.run") && !codes.has("billing.view_billed")) throw new AuthorizationError("Missing permission: billing.view_billed");
  const rows = await prisma.client.findMany({
    where: { organizationId, archivedAt: null, testDataMarkedAt: null },
    select: {
      id: true,
      legalFirstName: true,
      legalLastName: true,
      status: true,
      axisCareClientId: true,
      services: { select: { startDate: true, authorizationStart: true, authorizationEnd: true, authorizedHours: true } },
    },
    orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
  });
  return rows.map(row => ({
    id: row.id,
    name: `${row.legalFirstName} ${row.legalLastName}`,
    status: row.status,
    axisCareLinked: Boolean(row.axisCareClientId),
    serviceStart: row.services.map(service => (service.authorizationStart ?? service.startDate)?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    serviceEnd: row.services.map(service => service.authorizationEnd?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    approvedHours: row.services.some(service => service.authorizedHours !== null) ? row.services.reduce((sum, service) => sum + Number(service.authorizedHours ?? 0), 0) : null,
  }));
}

// ---- AxisCare-backed billing data -------------------------------------------------------------------------
// billing.run: sees everything (visits, rates, clock data) and may bill. billing.view_billed: billed amounts only.
export type BillingAccess = { canRun: boolean; canViewBilled: boolean; canManageIntegration: boolean };

export async function getBillingAccess(user: Pick<User, "id">, organizationId: string): Promise<BillingAccess> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const codes = await resolvePermissionCodes(membership.id);
  const canRun = codes.has("billing.run");
  const canViewBilled = canRun || codes.has("billing.view_billed");
  if (!canViewBilled) throw new AuthorizationError("Missing permission: billing.view_billed");
  return { canRun, canViewBilled, canManageIntegration: codes.has("organization.manage") };
}

export type BillingVisit = {
  id: string; clientId: string; startAt: string | null; clockInAt: string | null; clockOutAt: string | null;
  serviceCode: string | null; hours: number | null; rateCents: number | null; amountCents: number | null;
  waldahServiceType: string | null;
  compliant: boolean; reasons: EvvReason[];
};

/** Visits for linked clients, newest first, last 12 months. billing.run only. */
export async function getBillingVisits(user: Pick<User, "id">, organizationId: string, now = new Date()): Promise<BillingVisit[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "billing.run");
  const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - 12);
  const [rows, mappings] = await Promise.all([prisma.axisCareVisit.findMany({
    where: { organizationId, removed: false, clientId: { not: null }, startAt: { gte: since }, client: { testDataMarkedAt: null, archivedAt: null } },
    orderBy: { startAt: "desc" }, take: 5000,
    select: { id: true, clientId: true, startAt: true, clockInAt: true, clockOutAt: true, clockInLatitude: true, clockInLongitude: true, clockOutLatitude: true, clockOutLongitude: true, clockInPhone: true, clockOutPhone: true, serviceCode: true, chargeRateCents: true, removed: true }
  }), prisma.axisCareServiceMapping.findMany({ where: { organizationId }, select: { axisCareServiceCode: true, waldahServiceType: true } })]);
  const serviceTypes = new Map(mappings.map(mapping => [mapping.axisCareServiceCode, mapping.waldahServiceType]));
  return rows.map(row => {
    const evv = classifyEvv(row), rateCents = row.chargeRateCents;
    return { id: row.id, clientId: row.clientId!, startAt: row.startAt?.toISOString() ?? null, clockInAt: row.clockInAt?.toISOString() ?? null, clockOutAt: row.clockOutAt?.toISOString() ?? null, serviceCode: row.serviceCode, waldahServiceType: row.serviceCode ? serviceTypes.get(row.serviceCode) ?? null : null, hours: evv.hours, rateCents, amountCents: evv.hours !== null && rateCents !== null ? roundMoneyCents(evv.hours, rateCents) : null, compliant: evv.compliant, reasons: evv.reasons };
  });
}

export type PendingAxisCareMatch = { id: string; axisCareClientId: string; axisCareName: string; axisCareDateOfBirth: string | null; clientId: string; clientName: string; clientDateOfBirth: string | null; reason: string; score: number };

/** One-time confirmation list: AxisCare clients not yet tied to a Waldah client. billing.run only. */
export async function getPendingAxisCareMatches(user: Pick<User, "id">, organizationId: string): Promise<PendingAxisCareMatch[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "billing.run");
  const rows = await prisma.axisCareClientMatch.findMany({
    where: { organizationId, status: "SUGGESTED", client: { axisCareClientId: null, archivedAt: null, testDataMarkedAt: null } },
    orderBy: [{ axisCareClientId: "asc" }, { score: "desc" }], take: 200,
    select: { id: true, axisCareClientId: true, reason: true, score: true, client: { select: { id: true, legalFirstName: true, legalLastName: true, dateOfBirth: true } } }
  });
  const records = await prisma.axisCareRecord.findMany({ where: { organizationId, entity: "client", externalId: { in: [...new Set(rows.map(r => r.axisCareClientId))] } }, select: { externalId: true, payload: true } });
  const identity = new Map(records.map(r => [r.externalId, mapClientIdentity(r.payload as Record<string, unknown>)]));
  return rows.flatMap(row => row.client ? [{ id: row.id, axisCareClientId: row.axisCareClientId, axisCareName: [identity.get(row.axisCareClientId)?.firstName, identity.get(row.axisCareClientId)?.lastName].filter(Boolean).join(" ") || `AxisCare client ${row.axisCareClientId}`, axisCareDateOfBirth: identity.get(row.axisCareClientId)?.dateOfBirth ?? null, clientId: row.client.id, clientName: `${row.client.legalFirstName} ${row.client.legalLastName}`, clientDateOfBirth: row.client.dateOfBirth?.toISOString().slice(0, 10) ?? null, reason: row.reason, score: row.score }] : []);
}

/** Billed amounts per client: no billing ledger exists yet, so this reports only that fact. Wire to the ledger when it lands. */
export const BILLED_AMOUNTS_CONNECTED = false;
