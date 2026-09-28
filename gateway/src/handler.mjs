import { createHash, timingSafeEqual } from "node:crypto";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const ORGANIZATION_ID = /^c[a-z0-9]{24}$/;
const HASHED_KEY = /^[a-f0-9]{64}$/;
const SCOPE = /^[a-z0-9][a-z0-9:_-]{0,99}$/i;
const OBJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
const DEFAULT_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function response(statusCode, body) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) }; }
function safeEqual(actual, expected) {
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function bearer(event) { return event.headers?.authorization?.replace(/^Bearer\s+/i, "") ?? event.headers?.Authorization?.replace(/^Bearer\s+/i, "") ?? ""; }
function pathOf(event) { return event.rawPath ?? event.path ?? ""; }
function methodOf(event) { return event.requestContext?.http?.method ?? event.httpMethod ?? ""; }
function parseBody(event) {
  const source = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
  if (!source || Buffer.byteLength(source) > 4096) throw new Error("INVALID_REQUEST");
  try { return JSON.parse(source); } catch { throw new Error("INVALID_REQUEST"); }
}
function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
function log(event) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event })); }

function evidenceLocation(reference, organizationId, bucket) {
  let objectId;
  if (typeof reference === "string" && reference.startsWith("secure:")) objectId = reference.slice(7);
  else if (typeof reference === "string" && reference.startsWith("s3://")) {
    const parsed = new URL(reference);
    if (parsed.hostname !== bucket) throw new Error("INVALID_REFERENCE");
    const prefix = `/organizations/${organizationId}/evidence/`;
    if (!parsed.pathname.startsWith(prefix)) throw new Error("INVALID_REFERENCE");
    objectId = decodeURIComponent(parsed.pathname.slice(prefix.length));
  } else throw new Error("INVALID_REFERENCE");
  if (!OBJECT_ID.test(objectId) || objectId.includes("..")) throw new Error("INVALID_REFERENCE");
  return { Bucket: bucket, Key: `organizations/${organizationId}/evidence/${objectId}` };
}

export function createHandler({ dynamo = new DynamoDBClient({}), s3 = new S3Client({}), now = () => Date.now(), environment = process.env } = {}) {
  return async function handler(event, context = {}) {
    const requestId = context.awsRequestId ?? event.requestContext?.requestId ?? "unavailable";
    const path = pathOf(event), method = methodOf(event);
    let operation = "unknown";
    try {
      if (method !== "POST") return response(405, { error: "Method not allowed" });
      const isRateLimit = path.endsWith("/rate-limit"), isEvidence = path.endsWith("/evidence");
      if (!isRateLimit && !isEvidence) return response(404, { error: "Not found" });
      operation = isRateLimit ? "rate-limit" : "evidence";
      const expectedToken = isRateLimit ? environment.RATE_LIMIT_TOKEN : environment.EVIDENCE_STORAGE_TOKEN;
      if (!expectedToken || expectedToken.length < 20) throw new Error("CONFIGURATION_UNAVAILABLE");
      if (!safeEqual(bearer(event), expectedToken)) return response(401, { error: "Unauthorized" });
      const body = parseBody(event);

      if (isRateLimit) {
        if (!environment.RATE_LIMIT_TABLE_NAME) throw new Error("CONFIGURATION_UNAVAILABLE");
        if (!exactKeys(body, ["scope", "key", "limit", "windowSeconds"]) || !SCOPE.test(body.scope) || !HASHED_KEY.test(body.key) || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 10_000 || !Number.isInteger(body.windowSeconds) || body.windowSeconds < 1 || body.windowSeconds > 86_400) throw new Error("INVALID_REQUEST");
        const epochSeconds = Math.floor(now() / 1000), window = Math.floor(epochSeconds / body.windowSeconds), expiresAt = (window + 1) * body.windowSeconds;
        const id = createHash("sha256").update(`${body.scope}:${body.key}:${window}`).digest("hex");
        try {
          await dynamo.send(new UpdateItemCommand({ TableName: environment.RATE_LIMIT_TABLE_NAME, Key: { id: { S: id } }, UpdateExpression: "ADD #count :one SET #expiresAt = :expiresAt", ConditionExpression: "attribute_not_exists(#count) OR #count < :limit", ExpressionAttributeNames: { "#count": "count", "#expiresAt": "expiresAt" }, ExpressionAttributeValues: { ":one": { N: "1" }, ":limit": { N: String(body.limit) }, ":expiresAt": { N: String(expiresAt) } } }));
          log({ level: "info", operation, outcome: "allowed", requestId });
          return response(200, { allowed: true });
        } catch (error) {
          if (error?.name === "ConditionalCheckFailedException") { log({ level: "info", operation, outcome: "limited", requestId }); return response(200, { allowed: false }); }
          throw error;
        }
      }

      if (!environment.EVIDENCE_BUCKET_NAME || !environment.EVIDENCE_HEALTH_KEY) throw new Error("CONFIGURATION_UNAVAILABLE");
      if (body?.operation === "health" && exactKeys(body, ["operation"])) {
        await s3.send(new HeadObjectCommand({ Bucket: environment.EVIDENCE_BUCKET_NAME, Key: environment.EVIDENCE_HEALTH_KEY }));
        log({ level: "info", operation: "evidence-health", outcome: "available", requestId });
        return response(200, { ok: true });
      }
      if (body?.operation !== "verify" || !exactKeys(body, ["operation", "organizationId", "reference"]) || !ORGANIZATION_ID.test(body.organizationId)) throw new Error("INVALID_REQUEST");
      const location = evidenceLocation(body.reference, body.organizationId, environment.EVIDENCE_BUCKET_NAME);
      const object = await s3.send(new HeadObjectCommand(location));
      const allowedTypes = environment.EVIDENCE_ALLOWED_CONTENT_TYPES ? new Set(environment.EVIDENCE_ALLOWED_CONTENT_TYPES.split(",").map(value => value.trim()).filter(Boolean)) : DEFAULT_CONTENT_TYPES;
      const maxBytes = Number(environment.EVIDENCE_MAX_BYTES ?? 10_485_760);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("CONFIGURATION_UNAVAILABLE");
      if (object.Metadata?.["organization-id"] !== body.organizationId || !Number.isSafeInteger(object.ContentLength) || object.ContentLength < 1 || object.ContentLength > maxBytes || !object.ContentType || !allowedTypes.has(object.ContentType.toLowerCase())) throw new Error("EVIDENCE_NOT_ACCEPTABLE");
      log({ level: "info", operation: "evidence-verify", outcome: "verified", requestId, organizationId: body.organizationId });
      return response(200, { ok: true });
    } catch (error) {
      const invalid = ["INVALID_REQUEST", "INVALID_REFERENCE"].includes(error?.message);
      const missing = error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404 || error?.message === "EVIDENCE_NOT_ACCEPTABLE";
      log({ level: "error", operation, outcome: invalid ? "rejected" : missing ? "not-found" : "failed", requestId, errorCode: invalid ? "INVALID_REQUEST" : missing ? "EVIDENCE_UNAVAILABLE" : "DEPENDENCY_UNAVAILABLE" });
      if (invalid) return response(400, { error: "Invalid request" });
      if (missing) return response(404, { error: "Evidence unavailable" });
      return response(503, { error: "Gateway unavailable" });
    }
  };
}

export const handler = createHandler();
