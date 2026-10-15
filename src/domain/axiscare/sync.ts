import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AxisCareClient } from "./client";
import type { AxisCareConfig } from "./config";
import { hashPayload, mapClientIdentity, mapVisit, monthsAgo } from "./mapping";
import { proposeMatches } from "./matching";

type Json = Record<string, unknown>;
const toJson = (v: unknown) => v as Prisma.InputJsonValue;
const decimal = (v: number | null) => v === null ? null : v.toFixed(6);

// entity name -> list path. Everything here is a GET. Visits and schedules are windowed separately.
const SIMPLE_ENTITIES: { entity: string; path: string }[] = [
  { entity: "client", path: "/api/clients" }, { entity: "caregiver", path: "/api/caregivers" }, { entity: "contact", path: "/api/contacts" },
  { entity: "applicant", path: "/api/applicants" }, { entity: "adl", path: "/api/adls" }, { entity: "call_log", path: "/api/call-logs" },
  { entity: "tagging_category", path: "/api/taggingCategories" }, { entity: "organization", path: "/api/organizations" }
];

export function newClient(config: AxisCareConfig) { return new AxisCareClient({ baseUrl: config.AXISCARE_BASE_URL, token: config.AXISCARE_API_TOKEN }); }

/** Lightweight connection check: one small GET. Returns only whether it worked, never the token. */
export async function testConnection(config: AxisCareConfig) {
  try { const first = await newClient(config).list("/api/clients", "clients", { limit: 1 }).next(); return { ok: true as const, sawClients: !first.done }; }
  catch (error) { return { ok: false as const, status: (error as { status?: number }).status ?? 0 }; }
}

async function upsertRecord(organizationId: string, entity: string, raw: Json) {
  const externalId = raw.id === undefined || raw.id === null ? null : String(raw.id);
  if (!externalId) return false;
  const payloadHash = hashPayload(raw), now = new Date();
  await prisma.axisCareRecord.upsert({
    where: { organizationId_entity_externalId: { organizationId, entity, externalId } },
    create: { organizationId, entity, externalId, payload: toJson(raw), payloadHash, lastSyncedAt: now },
    update: { payload: toJson(raw), payloadHash, lastSyncedAt: now, removedAt: null }
  });
  return true;
}

export async function upsertVisit(organizationId: string, raw: Json, detail?: Json | null) {
  const mapped = mapVisit(raw);
  if (!mapped.externalId) return false;
  const payloadHash = hashPayload(raw), now = new Date();
  const link = mapped.axisCareClientId ? await prisma.client.findFirst({ where: { organizationId, axisCareClientId: mapped.axisCareClientId }, select: { id: true } }) : null;
  const { externalId, clockInLatitude, clockInLongitude, clockOutLatitude, clockOutLongitude, ...rest } = mapped;
  const data = { ...rest, clientId: link?.id ?? null, clockInLatitude: decimal(clockInLatitude), clockInLongitude: decimal(clockInLongitude), clockOutLatitude: decimal(clockOutLatitude), clockOutLongitude: decimal(clockOutLongitude), payload: toJson(raw), payloadHash, lastSyncedAt: now, ...(detail ? { detailPayload: toJson(detail) } : {}) };
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

/** Visits: first run backfills `historyMonths`; later runs fetch only visits changed since the last success (updatedSinceDate). */
export async function syncVisits(client: AxisCareClient, config: AxisCareConfig, now = new Date()) {
  const organizationId = config.AXISCARE_ORGANIZATION_ID;
  const state = await prisma.axisCareSyncState.findUnique({ where: { organizationId_entity: { organizationId, entity: "visit" } } });
  const startedAt = new Date();
  await setState(organizationId, "visit", { lastStartedAt: startedAt });
  const query: Record<string, string | number> = { limit: 100 };
  if (state?.backfillDone && state.lastSuccessAt) query.updatedSinceDate = new Date(state.lastSuccessAt.getTime() - 5 * 60_000).toISOString();
  else { query.startDate = monthsAgo(config.AXISCARE_HISTORY_MONTHS, now).toISOString(); query.endDate = new Date(now.getTime() + 31 * 86_400_000).toISOString(); }
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

/** Link AxisCare clients to Waldah clients: exact name+DOB links automatically, everything else becomes a suggestion for a person to confirm. */
export async function reconcileClientLinks(organizationId: string) {
  const [records, clients] = await Promise.all([
    prisma.axisCareRecord.findMany({ where: { organizationId, entity: "client", removedAt: null }, select: { payload: true } }),
    prisma.client.findMany({ where: { organizationId, archivedAt: null }, select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true, dateOfBirth: true, maPmiNumber: true, axisCareClientId: true } })
  ]);
  const decided = await prisma.axisCareClientMatch.findMany({ where: { organizationId, status: { in: ["CONFIRMED", "REJECTED"] } }, select: { axisCareClientId: true, clientId: true, status: true } });
  const rejected = new Set(decided.filter(d => d.status === "REJECTED").map(d => `${d.axisCareClientId}:${d.clientId}`));
  const summary = { autoLinked: 0, suggested: 0 };
  for (const { payload } of records) {
    const identity = mapClientIdentity(payload as Json);
    if (!identity.externalId) continue;
    if (clients.some(c => c.axisCareClientId === identity.externalId)) continue;
    const proposals = proposeMatches(identity, clients).filter(p => !rejected.has(`${identity.externalId}:${p.clientId}`));
    for (const p of proposals) {
      if (p.kind === "AUTO" && !clients.some(c => c.id === p.clientId && c.axisCareClientId)) {
        await prisma.$transaction([
          prisma.client.update({ where: { id: p.clientId }, data: { axisCareClientId: identity.externalId, axisCareServiceStartDate: identity.startDate ? new Date(identity.startDate) : undefined } }),
          prisma.axisCareClientMatch.upsert({ where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId: identity.externalId, clientId: p.clientId } }, create: { organizationId, axisCareClientId: identity.externalId, clientId: p.clientId, status: "AUTO_LINKED", score: p.score, reason: p.reason }, update: { status: "AUTO_LINKED", score: p.score, reason: p.reason } }),
          prisma.axisCareVisit.updateMany({ where: { organizationId, axisCareClientId: identity.externalId, clientId: null }, data: { clientId: p.clientId } })
        ]);
        const linked = clients.find(c => c.id === p.clientId); if (linked) linked.axisCareClientId = identity.externalId;
        summary.autoLinked += 1; break;
      }
      if (p.kind === "SUGGEST") {
        await prisma.axisCareClientMatch.upsert({ where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId: identity.externalId, clientId: p.clientId } }, create: { organizationId, axisCareClientId: identity.externalId, clientId: p.clientId, status: "SUGGESTED", score: p.score, reason: p.reason }, update: { score: p.score, reason: p.reason } });
        summary.suggested += 1;
      }
    }
  }
  return summary;
}

/** A person confirms a suggested match. Sets the AxisCare client ID on the Waldah client and attaches its visits. */
export async function confirmClientMatch(organizationId: string, matchId: string, decidedByUserId: string) {
  const match = await prisma.axisCareClientMatch.findFirst({ where: { id: matchId, organizationId, status: "SUGGESTED" } });
  if (!match?.clientId) return null;
  const record = await prisma.axisCareRecord.findUnique({ where: { organizationId_entity_externalId: { organizationId, entity: "client", externalId: match.axisCareClientId } }, select: { payload: true } });
  const startDate = record ? mapClientIdentity(record.payload as Json).startDate : null;
  await prisma.$transaction([
    prisma.client.update({ where: { id: match.clientId }, data: { axisCareClientId: match.axisCareClientId, axisCareServiceStartDate: startDate ? new Date(startDate) : undefined } }),
    prisma.axisCareClientMatch.update({ where: { id: match.id }, data: { status: "CONFIRMED", decidedByUserId, decidedAt: new Date() } }),
    prisma.axisCareClientMatch.updateMany({ where: { organizationId, axisCareClientId: match.axisCareClientId, status: "SUGGESTED", id: { not: match.id } }, data: { status: "REJECTED", decidedByUserId, decidedAt: new Date() } }),
    prisma.axisCareVisit.updateMany({ where: { organizationId, axisCareClientId: match.axisCareClientId, clientId: null }, data: { clientId: match.clientId } })
  ]);
  return match.clientId;
}

export async function runFullSync(config: AxisCareConfig) {
  const client = newClient(config), organizationId = config.AXISCARE_ORGANIZATION_ID, counts: Record<string, number> = {}, failures: string[] = [];
  for (const { entity, path } of SIMPLE_ENTITIES) {
    try { counts[entity] = await syncSimpleEntity(client, organizationId, entity, path); } catch { failures.push(entity); }
  }
  try { counts.visit = await syncVisits(client, config); } catch { failures.push("visit"); }
  const links = await reconcileClientLinks(organizationId);
  return { counts, failures, links };
}

/** Webhook events are thin; re-fetch the entity from AxisCare (GET) so we store the authoritative version. */
export async function processWebhookEvent(config: AxisCareConfig, eventId: string) {
  const organizationId = config.AXISCARE_ORGANIZATION_ID, row = await prisma.axisCareWebhookEvent.findUnique({ where: { id: eventId } });
  if (!row || row.processedAt) return;
  await prisma.axisCareWebhookEvent.update({ where: { id: eventId }, data: { attempts: { increment: 1 } } });
  try {
    const client = newClient(config), entity = row.entity ?? "", entityId = row.entityId;
    const paths: Record<string, [string, string, string]> = { client: ["/api/clients", "client", "clientIds"], caregiver: ["/api/caregivers", "caregiver", "caregiverIds"], applicant: ["/api/applicants", "applicant", "applicantIds"], calllog: ["/api/call-logs", "call_log", "callLogIds"] };
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
