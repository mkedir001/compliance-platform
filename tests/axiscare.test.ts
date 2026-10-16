import { afterEach, describe, expect, it, vi } from "vitest";
import { AxisCareApiError, AxisCareClient, AXISCARE_API_VERSION } from "@/domain/axiscare/client";
import { dollarsToCents, hashPayload, mapVisit, monthsAgo } from "@/domain/axiscare/mapping";
import { proposeMatches, type WaldahClientIdentity } from "@/domain/axiscare/matching";
import { parseWebhook, webhookIdMatches } from "@/domain/axiscare/webhook";
import { decryptAxisCareCredential, encryptAxisCareCredential } from "@/domain/axiscare/config";
import { sanitizeAxisCarePayload, testConnection, visitSyncQuery } from "@/domain/axiscare/sync";
import { axisCareConnectionDisplay } from "@/domain/axiscare/status";

afterEach(() => vi.unstubAllGlobals());

const visit = { id: "s=1:d=2023-10-01", client: { id: 1, firstName: "John", lastName: "Lakeman" }, caregiver: { id: 4, firstName: "Alice", lastName: "Tavner" }, startDate: "2023-10-01T16:00:00Z", endDate: "2023-10-01T18:00:00Z", scheduledStartDate: "2023-10-01T16:00:00Z", scheduledEndDate: "2023-10-01T18:00:00Z", clockIn: { time: "2023-10-01T12:01:22-04:00", method: "Mobile", coordinates: { latitude: "43.0389", longitude: "87.9065" }, telephonyPhone: null }, clockOut: { time: "2023-10-01T14:00:00-04:00", method: "Web", coordinates: null, location: null, telephonyPhone: null }, timezone: "US/Eastern", service: { id: 1, code: "HOMEMAKING", procedureCode: "S5130" }, type: "Hourly", verified: true, removed: false, chargeRate: 25.5, billableRateMode: "Hourly", modificationReason: { id: 3, name: "Scheduling Error" } };

describe("AxisCare visit mapping", () => {
  it("promotes billing and EVV fields and keeps clock-out without GPS as null", () => {
    const m = mapVisit(visit);
    expect(m).toMatchObject({ externalId: "s=1:d=2023-10-01", axisCareClientId: "1", axisCareCaregiverId: "4", serviceCode: "HOMEMAKING", procedureCode: "S5130", chargeRateCents: 2550, billableRateMode: "Hourly", clockInLatitude: 43.0389, clockOutLatitude: null, verified: true, modificationReason: "Scheduling Error" });
    expect(m.clockInAt?.toISOString()).toBe("2023-10-01T16:01:22.000Z");
  });
  it("tolerates a sparse visit", () => { expect(mapVisit({ id: "x" })).toMatchObject({ externalId: "x", chargeRateCents: null, clockInAt: null, verified: false }); });
  it("converts rates to cents without float drift", () => { expect(dollarsToCents(19.99)).toBe(1999); expect(dollarsToCents(null)).toBeNull(); expect(dollarsToCents("22.10")).toBe(2210); });
  it("hashes equal payloads equally", () => { expect(hashPayload({ a: 1 })).toBe(hashPayload({ a: 1 })); expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 })); });
  it("computes the history window", () => { expect(monthsAgo(12, new Date("2026-10-15T00:00:00Z")).toISOString()).toBe("2025-10-15T00:00:00.000Z"); });
  it("uses documented date-only initial filters and a five-minute incremental overlap", () => {
    expect(visitSyncQuery(12, null, new Date("2026-10-15T00:00:00Z"))).toMatchObject({ startDate: "2025-10-15", endDate: "2026-11-15" });
    expect(visitSyncQuery(12, { backfillDone: true, lastSuccessAt: new Date("2026-10-15T10:00:00Z") })).toMatchObject({ updatedSinceDate: "2026-10-15T09:55:00.000Z" });
  });
});

describe("AxisCare credential and minimum-necessary data boundaries", () => {
  const source = { AXISCARE_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  it("encrypts credentials with organization-bound authenticated encryption", () => {
    const encrypted = encryptAxisCareCredential("tenant-secret-token", "org-a", source);
    expect(encrypted).not.toContain("tenant-secret-token");
    expect(decryptAxisCareCredential(encrypted, "org-a", source)).toBe("tenant-secret-token");
    expect(() => decryptAxisCareCredential(encrypted, "org-b", source)).toThrow(/cannot be decrypted/);
  });
  it("does not persist client SSNs, addresses, free-text notes, or contact data", () => {
    expect(sanitizeAxisCarePayload("client", { id: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1815-12-10", ssn: "111-22-3333", priorityNote: "private", residentialAddress: { streetAddress1: "secret" }, personalEmail: "private@example.test", mobilePhone: "555" })).toEqual({ id: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1815-12-10" });
  });
});

const people = (over: Partial<WaldahClientIdentity>[] ): WaldahClientIdentity[] => over.map((o, i) => ({ id: `c${i}`, legalFirstName: "John", legalLastName: "Lakeman", preferredName: null, dateOfBirth: new Date("1972-05-12"), maPmiNumber: null, axisCareClientId: null, ...o }));
const axis = { externalId: "1", firstName: "John", lastName: "Lakeman", goesBy: "Sure Shot", dateOfBirth: "1972-05-12", medicaidNumber: null };

describe("AxisCare client matching", () => {
  it("requires confirmation even on exact name and DOB", () => { expect(proposeMatches(axis, people([{}]))[0]).toMatchObject({ clientId: "c0", kind: "SUGGEST", score: 100 }); });
  it("normalizes case, accents and punctuation without auto-linking", () => { expect(proposeMatches({ ...axis, firstName: "JOHN", lastName: "Lákeman" }, people([{}]))[0].kind).toBe("SUGGEST"); });
  it("suggests, not links, when the DOB differs", () => { const [m] = proposeMatches(axis, people([{ dateOfBirth: new Date("1973-05-12") }])); expect(m.kind).toBe("SUGGEST"); });
  it("suggests when a nickname matches the preferred name with the same DOB", () => { const [m] = proposeMatches({ ...axis, firstName: "Jonathan" }, people([{ legalFirstName: "Johnny", preferredName: "Jonathan" }])); expect(m.kind).toBe("SUGGEST"); });
  it("marks several exact candidates as ambiguous suggestions", () => { const m = proposeMatches(axis, people([{}, {}])); expect(m.every(x => x.kind === "SUGGEST" && x.score === 95)).toBe(true); });
  it("skips clients already tied to a different AxisCare client", () => { expect(proposeMatches(axis, people([{ axisCareClientId: "99" }]))).toEqual([]); });
  it("suggests on Medicaid number plus last name", () => { const [m] = proposeMatches({ ...axis, firstName: "Jo", dateOfBirth: null, medicaidNumber: "123" }, people([{ legalFirstName: "Joe", maPmiNumber: "123" }])); expect(m).toMatchObject({ kind: "SUGGEST", score: 90 }); });
  it("leaves a client unmatched when no reliable candidate exists", () => { expect(proposeMatches({ ...axis, firstName: "No", lastName: "Match", dateOfBirth: "1999-09-09" }, people([{}]))).toEqual([]); });
});

describe("AxisCare connection verification and display states", () => {
  it("performs a genuine authenticated client-list request and returns no credential", async () => {
    const fetcher = vi.fn(async () => res(200, { results: { clients: [{ id: 1 }], nextPage: null } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await testConnection({ AXISCARE_BASE_URL: "https://10461.axiscare.com", AXISCARE_API_TOKEN: "synthetic-test-token", AXISCARE_ORGANIZATION_ID: "org-test", AXISCARE_EXTRA_ENTITIES: [], AXISCARE_HISTORY_MONTHS: 12 });
    expect(result).toEqual({ ok: true, sawClients: true });
    expect(fetcher).toHaveBeenCalledWith("https://10461.axiscare.com/api/clients?limit=1", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer synthetic-test-token", "X-AxisCare-Api-Version": AXISCARE_API_VERSION }) }));
    expect(JSON.stringify(result)).not.toContain("synthetic-test-token");
  });

  it("distinguishes every user-facing connection state", () => {
    expect(axisCareConnectionDisplay("NOT_CONFIGURED")).toMatchObject({ label: "Not configured", tone: "neutral" });
    expect(axisCareConnectionDisplay("CONFIGURATION_INCOMPLETE")).toMatchObject({ label: "Saved, not verified", tone: "warning" });
    expect(axisCareConnectionDisplay("CONNECTED")).toMatchObject({ label: "Connected and verified", tone: "good" });
    expect(axisCareConnectionDisplay("AUTHENTICATION_FAILED")).toMatchObject({ label: "Authentication failed", tone: "danger" });
    expect(axisCareConnectionDisplay("CONNECTION_UNAVAILABLE")).toMatchObject({ label: "Connection unavailable", tone: "warning" });
  });
});

describe("AxisCare webhook intake", () => {
  it("checks the webhook id in constant time form", () => { expect(webhookIdMatches("abcdefghijk", "abcdefghijk")).toBe(true); expect(webhookIdMatches("abcdefghijx", "abcdefghijk")).toBe(false); expect(webhookIdMatches(null, "abcdefghijk")).toBe(false); });
  it("parses a thin event and dedupes identical deliveries", () => {
    const body = { version: "2025-06-20", event: "client.updated", description: "x", data: { entity: "client", action: "updated", id: 7 }, timestamp: "2026-10-15T10:00:00Z" };
    const a = parseWebhook(body), b = parseWebhook({ ...body });
    expect(a).toMatchObject({ event: "client.updated", entity: "client", entityId: "7" });
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(parseWebhook({ ...body, timestamp: "2026-10-15T10:05:00Z" }).dedupeKey).not.toBe(a.dedupeKey);
  });
  it("accepts visit events whose payload shape is unknown, and rejects junk", () => { expect(parseWebhook({ event: "scheduling.visit.clockedIn", data: { visitId: "s=1", extra: true } }).entityId).toBeNull(); expect(() => parseWebhook({ nope: true })).toThrow(); });
});

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
describe("AxisCare API client", () => {
  const make = (responses: Response[], seen: { url: string; init: RequestInit }[] = []) => new AxisCareClient({ baseUrl: "https://10461.axiscare.com", token: "tok-secret-value", sleep: async () => {}, fetcher: async (url, init) => { seen.push({ url, init }); return responses.shift()!; } });
  it("only issues GET with bearer token and version header", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    await make([res(200, { results: { clients: [] } })], seen).get("/api/clients", { limit: 1 });
    expect(seen[0].init.method).toBe("GET"); expect(seen[0].url).toBe("https://10461.axiscare.com/api/clients?limit=1");
    expect(seen[0].init.headers).toMatchObject({ Authorization: "Bearer tok-secret-value", "X-AxisCare-Api-Version": AXISCARE_API_VERSION });
  });
  it("follows nextPage across pages", async () => {
    const c = make([res(200, { results: { visits: [{ id: "a" }], nextPage: "https://10461.axiscare.com/api/visits?pageToken=2" } }), res(200, { results: { visits: [{ id: "b" }], nextPage: null } })]);
    const ids: string[] = []; for await (const page of c.list("/api/visits", "visits")) ids.push(...page.map(v => String(v.id)));
    expect(ids).toEqual(["a", "b"]);
  });
  it("falls back to the first array when the list key is unknown", async () => {
    const c = make([res(200, { results: { callLogs: [{ id: 1 }], nextPage: null } })]);
    const ids: string[] = []; for await (const page of c.list("/api/call-logs", null)) ids.push(...page.map(v => String(v.id)));
    expect(ids).toEqual(["1"]);
  });
  it("refuses to send the token to another host", async () => {
    await expect(make([]).get("https://evil.example.com/api/clients")).rejects.toBeInstanceOf(AxisCareApiError);
    expect(() => new AxisCareClient({ baseUrl: "https://example.com", token: "tok-secret-value" })).toThrow(/base URL is invalid/);
  });
  it("retries 429 and 5xx then succeeds, but not 4xx", async () => {
    expect(await make([res(429, {}, { "retry-after": "1" }), res(503), res(200, { ok: true })]).get("/api/x")).toEqual({ ok: true });
    await expect(make([res(403)]).get("/api/x")).rejects.toMatchObject({ status: 403 });
  });
  it("gives up after the retry limit without leaking the token", async () => {
    const err = await (make([res(500), res(500), res(500), res(500), res(500)]).get("/api/x")).catch((e: unknown) => e) as AxisCareApiError;
    expect(err.status).toBe(500); expect(err.message).not.toContain("tok-secret-value");
  });
  it("retries a transient network failure and rejects pagination loops", async () => {
    let attempts = 0;
    const client = new AxisCareClient({ baseUrl: "https://10461.axiscare.com", token: "tok-secret-value", sleep: async () => {}, fetcher: async () => { attempts += 1; if (attempts === 1) throw new Error("network"); return res(200, { results: { clients: [] } }); } });
    expect(await client.get("/api/clients")).toEqual({ results: { clients: [] } });
    const loop = make([res(200, { results: { clients: [{ id: 1 }], nextPage: "/api/clients" } })]);
    await expect((async () => { for await (const _page of loop.list("/api/clients", "clients")) void _page; })()).rejects.toThrow(/pagination did not terminate/);
  });
  it("treats a 200 response containing AxisCare errors as unsuccessful", async () => {
    await expect(make([res(200, { results: null, errors: ["denied"] })]).get("/api/clients")).rejects.toBeInstanceOf(AxisCareApiError);
  });
});
