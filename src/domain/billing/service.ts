import type { User } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { mapClientIdentity, mapClientLifecycle, type AxisCareClientLifecycle } from "@/domain/axiscare/mapping";
import { requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { evaluateEvv, roundMoneyCents, type EvvEvaluationState, type EvvReason } from "./evv";
import { prisma } from "@/lib/prisma";

export type BillingWorkspaceClient = {
  id: string;
  name: string;
  status: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  approvedHours: number | null;
  axisCareLinked: boolean;
  axisCareClientId: string | null;
};

export async function getBillingWorkspaceClients(user: Pick<User, "id">, organizationId: string): Promise<BillingWorkspaceClient[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const codes = await resolvePermissionCodes(membership.id);
  if (!codes.has("billing.view") && !codes.has("billing.run") && !codes.has("billing.view_billed")) throw new AuthorizationError("Missing permission: billing.view");
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
    // The AxisCare ID is shown on the row only to billing.run; view-only roles never receive it.
    axisCareClientId: codes.has("billing.mapping.manage") || codes.has("billing.run") ? row.axisCareClientId : null,
    serviceStart: row.services.map(service => (service.authorizationStart ?? service.startDate)?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    serviceEnd: row.services.map(service => service.authorizationEnd?.toISOString().slice(0, 10)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    approvedHours: row.services.some(service => service.authorizedHours !== null) ? row.services.reduce((sum, service) => sum + Number(service.authorizedHours ?? 0), 0) : null,
  }));
}

// ---- AxisCare-backed billing data -------------------------------------------------------------------------
// billing.run: sees everything (visits, rates, clock data) and may bill. billing.view_billed: billed amounts only.
export type BillingAccess = { canView: boolean; canInitiate: boolean; canRun: boolean; canManageMapping: boolean; canManageSync: boolean; canManageIntegration: boolean };

export async function getBillingAccess(user: Pick<User, "id">, organizationId: string): Promise<BillingAccess> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const codes = await resolvePermissionCodes(membership.id);
  const legacyRun = codes.has("billing.run"), canView = codes.has("billing.view") || legacyRun || codes.has("billing.view_billed"), canInitiate = codes.has("billing.initiate") || legacyRun;
  if (!canView) throw new AuthorizationError("Missing permission: billing.view");
  return { canView, canInitiate, canRun: canInitiate, canManageMapping: codes.has("billing.mapping.manage") || legacyRun, canManageSync: codes.has("billing.sync.manage") || legacyRun, canManageIntegration: codes.has("organization.manage") };
}

export type BillingVisit = {
  id: string; clientId: string; startAt: string | null; clockInAt: string | null; clockOutAt: string | null;
  serviceCode: string | null; hours: number | null; rateCents: number | null; amountCents: number | null;
  waldahServiceType: string | null;
  /** Staff who worked the shift: the Waldah employee when mapped, else the AxisCare caregiver name. */
  caregiverName: string | null;
  /** WIRING: billing outcome per visit from the billing ledger. Always null until billing runs exist. */
  result: null;
  compliant: boolean; evaluationState: EvvEvaluationState; reasons: EvvReason[];
};

/** Visits for linked clients, newest first, last 12 months. billing.run only. */
export async function getBillingVisits(user: Pick<User, "id">, organizationId: string, now = new Date(), clientId?: string): Promise<BillingVisit[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "billing.view");
  const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - 12);
  const [rows, mappings] = await Promise.all([prisma.axisCareVisit.findMany({
    where: { organizationId, removed: false, clientId: clientId ?? { not: null }, startAt: { gte: since }, client: { testDataMarkedAt: null, archivedAt: null } },
    orderBy: { startAt: "desc" }, take: 5000,
    select: { id: true, clientId: true, startAt: true, endAt: true, scheduledStartAt: true, scheduledEndAt: true, clockInAt: true, clockOutAt: true, clockInLatitude: true, clockInLongitude: true, clockOutLatitude: true, clockOutLongitude: true, clockInPhone: true, clockOutPhone: true, axisCareCaregiverId: true, employee: { select: { firstName: true, lastName: true } }, serviceCode: true, chargeRateCents: true, removed: true }
  }), prisma.axisCareServiceMapping.findMany({ where: { organizationId }, select: { axisCareServiceCode: true, waldahServiceType: true } })]);
  const caregiverIds = [...new Set(rows.flatMap(row => row.axisCareCaregiverId ? [row.axisCareCaregiverId] : []))];
  const caregiverRecords = caregiverIds.length ? await prisma.axisCareRecord.findMany({ where: { organizationId, entity: "caregiver", externalId: { in: caregiverIds } }, select: { externalId: true, payload: true } }) : [];
  const caregiverNames = new Map(caregiverRecords.map(record => { const p = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : {}; return [record.externalId, [p.firstName, p.lastName].filter(part => typeof part === "string").join(" ") || null] as const; }));
  const serviceTypes = new Map(mappings.map(mapping => [mapping.axisCareServiceCode, mapping.waldahServiceType]));
  return rows.map(row => {
    const evv = evaluateEvv(row, now), rateCents = row.chargeRateCents;
    return { id: row.id, clientId: row.clientId!, startAt: row.startAt?.toISOString() ?? null, clockInAt: row.clockInAt?.toISOString() ?? null, clockOutAt: row.clockOutAt?.toISOString() ?? null, serviceCode: row.serviceCode, waldahServiceType: row.serviceCode ? serviceTypes.get(row.serviceCode) ?? null : null, caregiverName: row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : row.axisCareCaregiverId ? caregiverNames.get(row.axisCareCaregiverId) ?? null : null, result: null, hours: evv.hours, rateCents, amountCents: evv.hours !== null && rateCents !== null ? roundMoneyCents(evv.hours, rateCents) : null, compliant: evv.compliant, evaluationState: evv.state, reasons: evv.reasons };
  });
}

export type AxisCareClientMatchRow = {
  axisCareClientId: string;
  axisCareName: string;
  axisCareDateOfBirth: string | null;
  axisCareLifecycle: AxisCareClientLifecycle;
  axisCareStatusLabel: string | null;
  state: "SUGGESTED" | "AMBIGUOUS" | "UNMATCHED" | "CONFIRMED" | "IGNORED";
  confirmedClientName: string | null;
  candidates: { id: string; clientId: string; clientName: string; clientDateOfBirth: string | null; reason: string; score: number }[];
  availableClients: { id: string; name: string; dateOfBirth: string | null }[];
};

/** Tenant-scoped AxisCare client review, including confirmed and ignored decisions. billing.run only. */
export async function getAxisCareClientMatches(user: Pick<User, "id">, organizationId: string): Promise<AxisCareClientMatchRow[]> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "billing.mapping.manage");
  const [rows, records, clients] = await Promise.all([
    prisma.axisCareClientMatch.findMany({
      where: { organizationId, status: "SUGGESTED", client: { axisCareClientId: null, archivedAt: null, testDataMarkedAt: null } },
      orderBy: [{ axisCareClientId: "asc" }, { score: "desc" }], take: 200,
      select: { id: true, axisCareClientId: true, reason: true, score: true, client: { select: { id: true, legalFirstName: true, legalLastName: true, dateOfBirth: true } } },
    }),
    prisma.axisCareRecord.findMany({ where: { organizationId, entity: "client", removedAt: null }, select: { externalId: true, payload: true, ignoredAt: true }, orderBy: { externalId: "asc" } }),
    prisma.client.findMany({ where: { organizationId, archivedAt: null, testDataMarkedAt: null }, select: { id: true, legalFirstName: true, legalLastName: true, dateOfBirth: true, axisCareClientId: true }, orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }] }),
  ]);
  const availableClients = clients.filter(client => !client.axisCareClientId).map(client => ({ id: client.id, name: `${client.legalFirstName} ${client.legalLastName}`, dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null }));
  const linked = new Map(clients.flatMap(client => client.axisCareClientId ? [[client.axisCareClientId, `${client.legalFirstName} ${client.legalLastName}`] as const] : []));
  return records.map(record => {
    const payload = record.payload as Record<string, unknown>, identity = mapClientIdentity(payload), lifecycle = mapClientLifecycle(payload);
    const candidates = rows.filter(row => row.axisCareClientId === record.externalId && row.client).map(row => ({ id: row.id, clientId: row.client!.id, clientName: `${row.client!.legalFirstName} ${row.client!.legalLastName}`, clientDateOfBirth: row.client!.dateOfBirth?.toISOString().slice(0, 10) ?? null, reason: row.reason, score: row.score }));
    const confirmedClientName = linked.get(record.externalId) ?? null;
    const state = record.ignoredAt ? "IGNORED" as const : confirmedClientName ? "CONFIRMED" as const : candidates.length === 0 ? "UNMATCHED" as const : candidates.length === 1 ? "SUGGESTED" as const : "AMBIGUOUS" as const;
    return { axisCareClientId: record.externalId, axisCareName: [identity.firstName, identity.lastName].filter(Boolean).join(" ") || `AxisCare client ${record.externalId}`, axisCareDateOfBirth: identity.dateOfBirth, axisCareLifecycle: lifecycle.lifecycle, axisCareStatusLabel: lifecycle.sourceLabel, state, confirmedClientName, candidates, availableClients: state === "CONFIRMED" || state === "IGNORED" ? [] : availableClients };
  });
}

/** Billed amounts per client: no billing ledger exists yet, so this reports only that fact. Wire to the ledger when it lands. */
export const BILLED_AMOUNTS_CONNECTED = false;
