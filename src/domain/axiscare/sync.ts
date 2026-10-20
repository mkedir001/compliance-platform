import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/domain/auth/errors";
import { operationalClientWhere, operationalEmployeeWhere } from "@/domain/test-data/visibility";
import { prisma } from "@/lib/prisma";
import { AxisCareClient } from "./client";
import type { AxisCareConfig } from "./config";
import { hashPayload, mapClientIdentity, mapVisit, monthsAgo } from "./mapping";
import { proposeMatches } from "./matching";

type Json = Record<string, unknown>;
const toJson = (v: unknown) => v as Prisma.InputJsonValue;
const obj = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
const decimal = (v: number | null) => v === null ? null : v.toFixed(6);

// Entity catalog. Every entry is a GET list. Notes and call logs can contain free-text care notes, so they are
// OFF by default; add an entity name to AXISCARE_EXTRA_ENTITIES to turn one on later (no code change needed).
// "Notes" (GET /api/notes/...) are not fetched anywhere yet; add an entry here when a use case exists.
export const AXISCARE_ENTITY_CATALOG: { entity: string; path: string; defaultOn: boolean }[] = [
  { entity: "client", path: "/api/clients", defaultOn: true }, { entity: "caregiver", path: "/api/caregivers", defaultOn: true },
  { entity: "contact", path: "/api/contacts", defaultOn: false }, { entity: "applicant", path: "/api/applicants", defaultOn: false },
  { entity: "adl", path: "/api/adls", defaultOn: false }, { entity: "tagging_category", path: "/api/taggingCategories", defaultOn: false },
  { entity: "organization", path: "/api/organizations", defaultOn: false },
  { entity: "call_log", path: "/api/call-logs", defaultOn: false }
];
export function enabledEntities(config: Pick<AxisCareConfig, "AXISCARE_EXTRA_ENTITIES">) {
  const extra = new Set(config.AXISCARE_EXTRA_ENTITIES);
  return AXISCARE_ENTITY_CATALOG.filter(e => e.defaultOn || extra.has(e.entity));
}

export function newClient(config: AxisCareConfig) { return new AxisCareClient({ baseUrl: config.AXISCARE_BASE_URL, token: config.AXISCARE_API_TOKEN }); }

const pick = (raw: Json, keys: string[]) => Object.fromEntries(keys.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
/** Keep only fields used by Waldah workflows. The AxisCare client response can include SSNs, addresses and free-text notes. */
export function sanitizeAxisCarePayload(entity: string, raw: Json): Json {
  if (entity === "client") return pick(raw, ["id", "firstName", "lastName", "goesBy", "dateOfBirth", "startDate", "medicaidNumber", "status", "externalId"]);
  if (entity === "caregiver") return pick(raw, ["id", "firstName", "lastName", "goesBy", "status", "externalId", "employeeNumber"]);
  return pick(raw, ["id", "code", "label", "name", "status", "externalId"]);
}

/** Lightweight connection check: one small GET. Returns only whether it worked, never the token. */
export async function testConnection(config: AxisCareConfig) {
  try { const first = await newClient(config).list("/api/clients", "clients", { limit: 1 }).next(); return { ok: true as const, sawClients: !first.done }; }
  catch (error) { return { ok: false as const, status: (error as { status?: number }).status ?? 0 }; }
}

async function upsertRecord(organizationId: string, entity: string, raw: Json) {
  const externalId = raw.id === undefined || raw.id === null ? null : String(raw.id);
  if (!externalId) return false;
  const payload = sanitizeAxisCarePayload(entity, raw), payloadHash = hashPayload(payload), now = new Date();
  await prisma.axisCareRecord.upsert({
    where: { organizationId_entity_externalId: { organizationId, entity, externalId } },
    create: { organizationId, entity, externalId, payload: toJson(payload), payloadHash, lastSyncedAt: now },
    update: { payload: toJson(payload), payloadHash, lastSyncedAt: now, removedAt: null }
  });
  return true;
}

export async function upsertVisit(organizationId: string, raw: Json, detail?: Json | null) {
  void detail; // Detail/ADL payload ingestion remains disabled until a minimum-necessary data contract is approved.
  const mapped = mapVisit(raw);
  if (!mapped.externalId) return false;
  const now = new Date();
  const [link, employee] = await Promise.all([
    mapped.axisCareClientId ? prisma.client.findFirst({ where: { organizationId, ...operationalClientWhere, axisCareClientId: mapped.axisCareClientId }, select: { id: true } }) : null,
    mapped.axisCareCaregiverId ? prisma.employee.findFirst({ where: { organizationId, ...operationalEmployeeWhere, axisCareCaregiverId: mapped.axisCareCaregiverId }, select: { id: true } }) : null,
  ]);
  const { externalId, clockInLatitude, clockInLongitude, clockOutLatitude, clockOutLongitude, ...rest } = mapped;
  const safeClock = (value: unknown) => { const clock = obj(value), coordinates = obj(clock?.coordinates); return clock ? { ...pick(clock, ["time", "method", "telephonyPhone"]), coordinates: coordinates ? pick(coordinates, ["latitude", "longitude"]) : null } : null; };
  const visitPayload = { id: raw.id, client: obj(raw.client) ? pick(obj(raw.client)!, ["id"]) : null, caregiver: obj(raw.caregiver) ? pick(obj(raw.caregiver)!, ["id"]) : null, startDate: raw.startDate, endDate: raw.endDate, scheduledStartDate: raw.scheduledStartDate, scheduledEndDate: raw.scheduledEndDate, clockIn: safeClock(raw.clockIn), clockOut: safeClock(raw.clockOut), timezone: raw.timezone, service: obj(raw.service) ? pick(obj(raw.service)!, ["id", "code", "description", "procedureCode"]) : null, type: raw.type, verified: raw.verified, removed: raw.removed, chargeRate: raw.chargeRate, billableRateMode: raw.billableRateMode, modificationReason: obj(raw.modificationReason) ? pick(obj(raw.modificationReason)!, ["id", "name"]) : null };
  const data = { ...rest, clientId: link?.id ?? null, employeeId: employee?.id ?? null, clockInLatitude: decimal(clockInLatitude), clockInLongitude: decimal(clockInLongitude), clockOutLatitude: decimal(clockOutLatitude), clockOutLongitude: decimal(clockOutLongitude), payload: toJson(visitPayload), payloadHash: hashPayload(visitPayload), lastSyncedAt: now };
  await prisma.axisCareVisit.upsert({ where: { organizationId_externalId: { organizationId, externalId } }, create: { organizationId, externalId, ...data }, update: data });
  return true;
}

async function setState(organizationId: string, entity: string, data: { lastStartedAt?: Date; lastSuccessAt?: Date; lastError?: string | null; lastCount?: number; backfillDone?: boolean }) {
  await prisma.axisCareSyncState.upsert({ where: { organizationId_entity: { organizationId, entity } }, create: { organizationId, entity, ...data }, update: data });
}

export async function syncSimpleEntity(client: AxisCareClient, organizationId: string, entity: string, path: string) {
  await setState(organizationId, entity, { lastStartedAt: new Date() });
  let count = 0;
  try {
    for await (const page of client.list(path, null, { limit: 100 })) for (const raw of page) if (await upsertRecord(organizationId, entity, raw)) count += 1;
    await setState(organizationId, entity, { lastSuccessAt: new Date(), lastError: null, lastCount: count });
  } catch (error) {
    await setState(organizationId, entity, { lastError: error instanceof Error ? error.message : "Sync failed" });
    throw error;
  }
  return count;
}

export function visitSyncQuery(historyMonths: number, state: { backfillDone: boolean; lastSuccessAt: Date | null } | null, now = new Date()) {
  const query: Record<string, string | number> = { limit: 100 };
  if (state?.backfillDone && state.lastSuccessAt) query.updatedSinceDate = new Date(state.lastSuccessAt.getTime() - 5 * 60_000).toISOString();
  else { query.startDate = monthsAgo(historyMonths, now).toISOString().slice(0, 10); query.endDate = new Date(now.getTime() + 31 * 86_400_000).toISOString().slice(0, 10); }
  return query;
}

/** Visits: first run backfills `historyMonths`; later runs fetch only visits changed since the last success (updatedSinceDate). */
export async function syncVisits(client: AxisCareClient, config: AxisCareConfig, now = new Date()) {
  const organizationId = config.AXISCARE_ORGANIZATION_ID;
  const state = await prisma.axisCareSyncState.findUnique({ where: { organizationId_entity: { organizationId, entity: "visit" } } });
  const startedAt = new Date();
  await setState(organizationId, "visit", { lastStartedAt: startedAt });
  const query = visitSyncQuery(config.AXISCARE_HISTORY_MONTHS, state, now);
  let count = 0;
  try {
    for await (const page of client.list("/api/visits", "visits", query)) for (const raw of page) if (await upsertVisit(organizationId, raw)) count += 1;
    await setState(organizationId, "visit", { lastSuccessAt: startedAt, lastError: null, lastCount: count, backfillDone: true });
  } catch (error) {
    await setState(organizationId, "visit", { lastError: error instanceof Error ? error.message : "Sync failed" });
    throw error;
  }
  return count;
}

/** Build review suggestions only. Synchronization never links or changes a canonical Waldah client. */
export async function reconcileClientLinks(organizationId: string) {
  const [records, clients] = await Promise.all([
    prisma.axisCareRecord.findMany({ where: { organizationId, entity: "client", removedAt: null }, select: { payload: true } }),
    prisma.client.findMany({ where: { organizationId, ...operationalClientWhere, archivedAt: null }, select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true, dateOfBirth: true, maPmiNumber: true, axisCareClientId: true } })
  ]);
  const decided = await prisma.axisCareClientMatch.findMany({ where: { organizationId, status: { in: ["CONFIRMED", "REJECTED"] } }, select: { axisCareClientId: true, clientId: true, status: true } });
  const rejected = new Set(decided.filter(d => d.status === "REJECTED").map(d => `${d.axisCareClientId}:${d.clientId}`));
  const summary = { axisCareClients: records.length, confirmed: clients.filter(client => client.axisCareClientId).length, suggested: 0, suggestedClients: 0, ambiguous: 0, unmatched: 0 };
  for (const { payload } of records) {
    const identity = mapClientIdentity(payload as Json);
    if (!identity.externalId) continue;
    const axisCareClientId = identity.externalId;
    if (clients.some(c => c.axisCareClientId === axisCareClientId)) continue;
    const proposals = proposeMatches(identity, clients).filter(p => !rejected.has(`${axisCareClientId}:${p.clientId}`));
    if (!proposals.length) summary.unmatched += 1;
    else if (proposals.length > 1) summary.ambiguous += 1;
    else summary.suggestedClients += 1;
    for (const p of proposals) {
      await prisma.axisCareClientMatch.upsert({ where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId, clientId: p.clientId } }, create: { organizationId, axisCareClientId, clientId: p.clientId, status: "SUGGESTED", score: p.score, reason: p.reason }, update: { score: p.score, reason: p.reason } });
      summary.suggested += 1;
    }
  }
  return summary;
}

/** Explicit administrator selection for a source client that may have no heuristic suggestion. */
export async function confirmExplicitClientMatch(organizationId: string, axisCareClientId: string, clientId: string, decidedByUserId: string) {
  const [source, target] = await Promise.all([
    prisma.axisCareRecord.findUnique({ where: { organizationId_entity_externalId: { organizationId, entity: "client", externalId: axisCareClientId } }, select: { id: true, removedAt: true } }),
    prisma.client.findFirst({ where: { id: clientId, organizationId, ...operationalClientWhere, archivedAt: null }, select: { id: true } }),
  ]);
  if (!source || source.removedAt || !target) return null;
  const match = await prisma.axisCareClientMatch.upsert({
    where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId, clientId } },
    create: { organizationId, axisCareClientId, clientId, status: "SUGGESTED", score: 0, reason: "Selected explicitly by an authorized administrator" },
    update: { status: "SUGGESTED", score: 0, reason: "Selected explicitly by an authorized administrator", decidedAt: null, decidedByUserId: null },
    select: { id: true },
  });
  return confirmClientMatch(organizationId, match.id, decidedByUserId);
}

/** A person confirms a suggested match. Only the external link is stored; canonical client fields are untouched. */
export async function confirmClientMatch(organizationId: string, matchId: string, decidedByUserId: string) {
  return prisma.$transaction(async tx => {
    const match = await tx.axisCareClientMatch.findFirst({ where: { id: matchId, organizationId, status: "SUGGESTED" } });
    if (!match?.clientId) return null;
    const [client, externalClaim] = await Promise.all([
      tx.client.findFirst({ where: { id: match.clientId, organizationId, ...operationalClientWhere }, select: { axisCareClientId: true } }),
      tx.client.findFirst({ where: { organizationId, axisCareClientId: match.axisCareClientId, id: { not: match.clientId } }, select: { id: true } }),
    ]);
    if (!client) return null;
    if (client.axisCareClientId && client.axisCareClientId !== match.axisCareClientId) throw new ConflictError("Waldah client is already matched to another AxisCare client", "WALDAH_CLIENT_ALREADY_MATCHED");
    if (externalClaim) throw new ConflictError("AxisCare client is already matched to another Waldah client", "AXISCARE_CLIENT_ALREADY_MATCHED");
    const claimed = await tx.client.updateMany({ where: { id: match.clientId, organizationId, ...operationalClientWhere, OR: [{ axisCareClientId: null }, { axisCareClientId: match.axisCareClientId }] }, data: { axisCareClientId: match.axisCareClientId } });
    if (claimed.count !== 1) return null;
    await tx.axisCareClientMatch.update({ where: { id: match.id }, data: { status: "CONFIRMED", decidedByUserId, decidedAt: new Date() } });
    await tx.axisCareClientMatch.updateMany({ where: { organizationId, status: "SUGGESTED", id: { not: match.id }, OR: [{ axisCareClientId: match.axisCareClientId }, { clientId: match.clientId }] }, data: { status: "REJECTED", decidedByUserId, decidedAt: new Date() } });
    await tx.axisCareVisit.updateMany({ where: { organizationId, axisCareClientId: match.axisCareClientId, clientId: null }, data: { clientId: match.clientId } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: decidedByUserId, eventType: "axiscare.client_mapped", entityType: "Client", entityId: match.clientId, metadataJson: { axisCareClientId: match.axisCareClientId } } });
    return match.clientId;
  }, { isolationLevel: "Serializable" });
}

export async function runFullSync(config: AxisCareConfig) {
  const client = newClient(config), organizationId = config.AXISCARE_ORGANIZATION_ID, counts: Record<string, number> = {}, failures: string[] = [], failureDetails: { entity: string; category: string; retryable: boolean }[] = [];
  const failed = (entity: string, error: unknown) => {
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
    const category = status === 401 ? "AUTHENTICATION_FAILURE" : status === 403 ? "PERMISSION_FAILURE" : status === 429 || status !== null && status >= 500 ? "API_RESPONSE_FAILURE" : entity === "client" ? "CLIENT_DISCOVERY_FAILURE" : status !== null ? "API_RESPONSE_FAILURE" : "STAGING_FAILURE";
    failures.push(entity); failureDetails.push({ entity, category, retryable: status === 429 || status !== null && status >= 500 });
  };
  for (const { entity, path } of enabledEntities(config)) {
    try { counts[entity] = await syncSimpleEntity(client, organizationId, entity, path); } catch (error) { failed(entity, error); }
  }
  try { counts.visit = await syncVisits(client, config); } catch (error) { failed("visit", error); }
  const links = await reconcileClientLinks(organizationId);
  return { counts, failures, failureDetails, links };
}

/** Webhook events are thin; re-fetch the entity from AxisCare (GET) so we store the authoritative version. */
export async function processWebhookEvent(config: AxisCareConfig, eventId: string) {
  const organizationId = config.AXISCARE_ORGANIZATION_ID, row = await prisma.axisCareWebhookEvent.findFirst({ where: { id: eventId, organizationId } });
  if (!row || row.processedAt) return;
  await prisma.axisCareWebhookEvent.update({ where: { id: eventId }, data: { attempts: { increment: 1 } } });
  try {
    const client = newClient(config), entity = row.entity ?? "", entityId = row.entityId;
    const paths: Record<string, [string, string, string]> = { client: ["/api/clients", "client", "clientIds"], caregiver: ["/api/caregivers", "caregiver", "caregiverIds"], applicant: ["/api/applicants", "applicant", "applicantIds"] };
    if (enabledEntities(config).some(e => e.entity === "call_log")) paths.calllog = ["/api/call-logs", "call_log", "callLogIds"];
    if (entityId && paths[entity]) {
      const [path, kind, param] = paths[entity];
      for await (const page of client.list(path, null, { [param]: entityId })) for (const raw of page) await upsertRecord(organizationId, kind, raw);
      if (entity === "client") await reconcileClientLinks(organizationId);
    } else if (row.event.startsWith("scheduling.visit")) {
      // The visit event payload shape is not documented; a bounded incremental visit sync picks the change up.
      await syncVisits(client, config);
    }
    await prisma.axisCareWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), lastError: null } });
  } catch (error) {
    await prisma.axisCareWebhookEvent.update({ where: { id: eventId }, data: { lastError: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" } });
  }
}

export async function processPendingWebhookEvents(config: AxisCareConfig, limit = 50) {
  const pending = await prisma.axisCareWebhookEvent.findMany({ where: { organizationId: config.AXISCARE_ORGANIZATION_ID, processedAt: null, attempts: { lt: 5 } }, orderBy: { receivedAt: "asc" }, take: limit, select: { id: true } });
  for (const { id } of pending) await processWebhookEvent(config, id);
  return pending.length;
}

export async function rejectClientMatch(organizationId: string, matchId: string, decidedByUserId: string) {
  const result = await prisma.axisCareClientMatch.updateMany({ where: { id: matchId, organizationId, status: "SUGGESTED" }, data: { status: "REJECTED", decidedByUserId, decidedAt: new Date() } });
  return result.count === 1;
}
