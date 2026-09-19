import { z } from "zod";
import { productionEnvironment } from "@/lib/env";
import { recordOperationalEvent } from "@/lib/observability";

const gatewayResponse = z.object({ ok: z.boolean() });

async function gateway(operation: "health" | "verify", body: Record<string, string> = {}) {
  const config = productionEnvironment();
  if (!config) return { ok: true };
  try {
    const response = await fetch(config.EVIDENCE_STORAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${config.EVIDENCE_STORAGE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ operation, ...body }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("gateway rejected request");
    const result = gatewayResponse.parse(await response.json());
    if (!result.ok) throw new Error("object unavailable");
    return result;
  } catch (error) {
    await recordOperationalEvent({ level: "error", operation: `evidence.storage.${operation}.failed`, organizationId: body.organizationId, errorName: error instanceof Error ? error.name : "UnknownError", message: "Evidence storage operation failed" });
    throw new Error("Private evidence storage is unavailable; evidence was not recorded");
  }
}

export async function probeEvidenceStorage() { await gateway("health"); return true; }
export async function requireStoredEvidence(organizationId: string, reference: string) {
  if (process.env.NODE_ENV === "production") await gateway("verify", { organizationId, reference });
}
