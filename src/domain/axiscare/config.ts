import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ValidationError } from "@/domain/auth/errors";
import { prisma } from "@/lib/prisma";

export const axisCareConnectionInput = z.object({
  baseUrl: z.string().url().transform(value => value.replace(/\/$/, "")).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && /^[a-z0-9-]+\.axiscare\.com$/i.test(url.hostname) && url.pathname === "/" && !url.search && !url.hash;
  }, "Use the HTTPS URL for one AxisCare site, for example https://10461.axiscare.com"),
  apiToken: z.string().min(10).max(4096).optional(),
  historyMonths: z.number().int().min(1).max(60).default(12),
}).strict();

export type AxisCareConfig = {
  AXISCARE_BASE_URL: string;
  AXISCARE_API_TOKEN: string;
  AXISCARE_ORGANIZATION_ID: string;
  AXISCARE_EXTRA_ENTITIES: string[];
  AXISCARE_HISTORY_MONTHS: number;
};

const keyFrom = (source: Record<string, string | undefined> = process.env) => {
  const encoded = source.AXISCARE_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new ValidationError("AxisCare credential encryption is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new ValidationError("AxisCare credential encryption is not configured");
  return key;
};

export function encryptAxisCareCredential(value: string, organizationId: string, source: Record<string, string | undefined> = process.env) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyFrom(source), iv);
  cipher.setAAD(Buffer.from(`axiscare:${organizationId}:v1`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptAxisCareCredential(value: string, organizationId: string, source: Record<string, string | undefined> = process.env) {
  const [version, iv, tag, encrypted, ...extra] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted || extra.length) throw new ValidationError("AxisCare credential cannot be decrypted");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(source), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`axiscare:${organizationId}:v1`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ValidationError("AxisCare credential cannot be decrypted"); }
}

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export async function saveAxisCareConnection(organizationId: string, actorUserId: string, input: z.input<typeof axisCareConnectionInput>) {
  const parsed = axisCareConnectionInput.parse(input);
  const existing = await prisma.axisCareConnection.findUnique({ where: { organizationId } });
  if (!parsed.apiToken && !existing) throw new ValidationError("An AxisCare API token is required for initial configuration");
  const encryptedApiToken = parsed.apiToken ? encryptAxisCareCredential(parsed.apiToken, organizationId) : existing!.encryptedApiToken;
  const tokenFingerprint = parsed.apiToken ? fingerprint(parsed.apiToken) : existing!.tokenFingerprint;
  const connection = await prisma.$transaction(async tx => {
    const row = await tx.axisCareConnection.upsert({
      where: { organizationId },
      create: { organizationId, baseUrl: parsed.baseUrl, encryptedApiToken, tokenFingerprint, historyMonths: parsed.historyMonths, createdByUserId: actorUserId, updatedByUserId: actorUserId },
      update: { baseUrl: parsed.baseUrl, encryptedApiToken, tokenFingerprint, historyMonths: parsed.historyMonths, status: "CONFIGURATION_INCOMPLETE", lastErrorCode: null, updatedByUserId: actorUserId },
    });
    await tx.auditEvent.create({ data: { organizationId, actorUserId, eventType: existing ? "axiscare.connection_updated" : "axiscare.connection_configured", entityType: "AxisCareConnection", entityId: row.id, metadataJson: { baseUrl: parsed.baseUrl, tokenReplaced: Boolean(parsed.apiToken), historyMonths: parsed.historyMonths } } });
    return row;
  });
  return safeConnection(connection);
}

export function safeConnection(connection: { baseUrl: string; status: string; lastTestedAt: Date | null; lastConnectedAt: Date | null; lastErrorCode: string | null; historyMonths: number } | null) {
  return connection ? { configured: true, baseUrl: connection.baseUrl, status: connection.status, lastTestedAt: connection.lastTestedAt?.toISOString() ?? null, lastConnectedAt: connection.lastConnectedAt?.toISOString() ?? null, lastErrorCode: connection.lastErrorCode, historyMonths: connection.historyMonths } : { configured: false, baseUrl: null, status: "NOT_CONFIGURED", lastTestedAt: null, lastConnectedAt: null, lastErrorCode: null, historyMonths: 12 };
}

export async function getAxisCareConnectionStatus(organizationId: string) {
  return safeConnection(await prisma.axisCareConnection.findUnique({ where: { organizationId }, select: { baseUrl: true, status: true, lastTestedAt: true, lastConnectedAt: true, lastErrorCode: true, historyMonths: true } }));
}

export async function loadAxisCareConfig(organizationId: string): Promise<AxisCareConfig | null> {
  const row = await prisma.axisCareConnection.findUnique({ where: { organizationId } });
  if (!row) return null;
  return { AXISCARE_BASE_URL: row.baseUrl, AXISCARE_API_TOKEN: decryptAxisCareCredential(row.encryptedApiToken, organizationId), AXISCARE_ORGANIZATION_ID: organizationId, AXISCARE_EXTRA_ENTITIES: row.extraEntities.split(",").map(value => value.trim()).filter(Boolean), AXISCARE_HISTORY_MONTHS: row.historyMonths };
}

export async function listAxisCareConfigs(): Promise<AxisCareConfig[]> {
  const rows = await prisma.axisCareConnection.findMany({ where: { status: "CONNECTED" }, select: { organizationId: true } });
  const configs = await Promise.all(rows.map(row => loadAxisCareConfig(row.organizationId)));
  return configs.filter((config): config is AxisCareConfig => Boolean(config));
}

export async function recordAxisCareConnectionTest(organizationId: string, actorUserId: string, result: { ok: boolean; status?: number }) {
  const now = new Date();
  const status = result.ok ? "CONNECTED" : result.status === 401 || result.status === 403 ? "AUTHENTICATION_FAILED" : "CONNECTION_UNAVAILABLE";
  const lastErrorCode = result.ok ? null : status;
  const row = await prisma.$transaction(async tx => {
    const connection = await tx.axisCareConnection.update({ where: { organizationId }, data: { status, lastTestedAt: now, lastConnectedAt: result.ok ? now : undefined, lastErrorCode, updatedByUserId: actorUserId } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId, eventType: "axiscare.connection_tested", entityType: "AxisCareConnection", entityId: connection.id, metadataJson: { status, httpStatusClass: result.status ? `${Math.floor(result.status / 100)}xx` : null } } });
    return connection;
  });
  return safeConnection(row);
}
