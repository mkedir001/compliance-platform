import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createHandler } from "../src/handler.mjs";

const organizationId = `c${"a".repeat(24)}`;
const otherOrganizationId = `c${"b".repeat(24)}`;
const hashedKey = "c".repeat(64);
const environment = {
  RATE_LIMIT_TOKEN: "rate-limit-token-for-tests",
  RATE_LIMIT_TABLE_NAME: "rate-limits",
  EVIDENCE_STORAGE_TOKEN: "evidence-storage-token-tests",
  EVIDENCE_BUCKET_NAME: "private-evidence",
  EVIDENCE_HEALTH_KEY: "health/ready",
  EVIDENCE_MAX_BYTES: "10485760",
};
const request = (path, token, body, method = "POST") => ({ path: `/prod${path}`, httpMethod: method, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body), requestContext: { requestId: "request-1" } });
const body = result => JSON.parse(result.body);
let logs;

beforeEach(() => { logs = []; console.log = value => logs.push(value); });
afterEach(() => { console.log = originalLog; });
const originalLog = console.log;

test("rejects unsupported methods, paths, and path-specific bearer tokens", async () => {
  const handler = createHandler({ environment, dynamo: { send: async () => ({}) }, s3: { send: async () => ({}) } });
  assert.equal((await handler(request("/rate-limit", environment.RATE_LIMIT_TOKEN, {}, "GET"))).statusCode, 405);
  assert.equal((await handler(request("/unknown", environment.RATE_LIMIT_TOKEN, {}))).statusCode, 404);
  assert.equal((await handler(request("/rate-limit", environment.EVIDENCE_STORAGE_TOKEN, {}))).statusCode, 401);
  assert.equal((await handler(request("/evidence", environment.RATE_LIMIT_TOKEN, { operation: "health" }))).statusCode, 401);
});

test("performs a fixed-window atomic rate-limit update without storing the supplied key", async () => {
  let command;
  const handler = createHandler({ environment, now: () => 120_000, dynamo: { send: async value => { command = value; return {}; } }, s3: { send: async () => ({}) } });
  const result = await handler(request("/rate-limit", environment.RATE_LIMIT_TOKEN, { scope: "portal-claim", key: hashedKey, limit: 5, windowSeconds: 60 }));
  assert.equal(result.statusCode, 200); assert.deepEqual(body(result), { allowed: true });
  assert.equal(command.input.TableName, "rate-limits"); assert.equal(command.input.ExpressionAttributeValues[":limit"].N, "5"); assert.equal(command.input.ExpressionAttributeValues[":expiresAt"].N, "180");
  assert.equal(command.input.Key.id.S.length, 64); assert.notEqual(command.input.Key.id.S, hashedKey); assert.ok(!JSON.stringify(command.input).includes("portal-claim"));
});

test("returns allowed false only for an atomic conditional limit failure and fails closed otherwise", async () => {
  const conditional = Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
  const limited = createHandler({ environment, dynamo: { send: async () => { throw conditional; } }, s3: { send: async () => ({}) } });
  const unavailable = createHandler({ environment, dynamo: { send: async () => { throw new Error("database secret detail"); } }, s3: { send: async () => ({}) } });
  const input = request("/rate-limit", environment.RATE_LIMIT_TOKEN, { scope: "report-export", key: hashedKey, limit: 1, windowSeconds: 60 });
  assert.deepEqual(body(await limited(input)), { allowed: false });
  const failed = await unavailable(input); assert.equal(failed.statusCode, 503); assert.deepEqual(body(failed), { error: "Gateway unavailable" });
  assert.ok(!logs.join(" ").includes("database secret detail")); assert.ok(!logs.join(" ").includes(environment.RATE_LIMIT_TOKEN));
});

test("checks the private S3 sentinel for evidence health", async () => {
  let command;
  const handler = createHandler({ environment, dynamo: { send: async () => ({}) }, s3: { send: async value => { command = value; return {}; } } });
  const result = await handler(request("/evidence", environment.EVIDENCE_STORAGE_TOKEN, { operation: "health" }));
  assert.equal(result.statusCode, 200); assert.deepEqual(body(result), { ok: true }); assert.deepEqual(command.input, { Bucket: "private-evidence", Key: "health/ready" });
});

test("verifies only tenant-prefixed private objects with matching metadata, bounded size, and allowed type", async () => {
  let command;
  const handler = createHandler({ environment, dynamo: { send: async () => ({}) }, s3: { send: async value => { command = value; return { Metadata: { "organization-id": organizationId }, ContentLength: 2048, ContentType: "application/pdf" }; } } });
  const result = await handler(request("/evidence", environment.EVIDENCE_STORAGE_TOKEN, { operation: "verify", organizationId, reference: "secure:certificate-2026.pdf" }));
  assert.equal(result.statusCode, 200); assert.deepEqual(body(result), { ok: true }); assert.deepEqual(command.input, { Bucket: "private-evidence", Key: `organizations/${organizationId}/evidence/certificate-2026.pdf` });
});

test("rejects cross-tenant references before S3 and rejects mismatched object ownership", async () => {
  let calls = 0;
  const crossTenant = createHandler({ environment, dynamo: { send: async () => ({}) }, s3: { send: async () => { calls += 1; return {}; } } });
  const cross = await crossTenant(request("/evidence", environment.EVIDENCE_STORAGE_TOKEN, { operation: "verify", organizationId, reference: `s3://private-evidence/organizations/${otherOrganizationId}/evidence/file.pdf` }));
  assert.equal(cross.statusCode, 400); assert.equal(calls, 0);
  const wrongOwner = createHandler({ environment, dynamo: { send: async () => ({}) }, s3: { send: async () => ({ Metadata: { "organization-id": otherOrganizationId }, ContentLength: 100, ContentType: "application/pdf" }) } });
  const rejected = await wrongOwner(request("/evidence", environment.EVIDENCE_STORAGE_TOKEN, { operation: "verify", organizationId, reference: "secure:file.pdf" }));
  assert.equal(rejected.statusCode, 404); assert.deepEqual(body(rejected), { error: "Evidence unavailable" });
  assert.ok(!logs.join(" ").includes("file.pdf")); assert.ok(!logs.join(" ").includes(environment.EVIDENCE_STORAGE_TOKEN));
});

test("rejects malformed and oversized requests without dependency access", async () => {
  let calls = 0;
  const handler = createHandler({ environment, dynamo: { send: async () => { calls += 1; } }, s3: { send: async () => { calls += 1; } } });
  const invalid = await handler({ path: "/rate-limit", httpMethod: "POST", headers: { authorization: `Bearer ${environment.RATE_LIMIT_TOKEN}` }, body: "{" });
  assert.equal(invalid.statusCode, 400);
  const oversized = await handler({ path: "/rate-limit", httpMethod: "POST", headers: { authorization: `Bearer ${environment.RATE_LIMIT_TOKEN}` }, body: JSON.stringify({ value: "x".repeat(4096) }) });
  assert.equal(oversized.statusCode, 400);
  const extra = await handler(request("/rate-limit", environment.RATE_LIMIT_TOKEN, { scope: "x", key: hashedKey, limit: 1, windowSeconds: 60, secret: "no" }));
  assert.equal(extra.statusCode, 400); assert.equal(calls, 0);
});
