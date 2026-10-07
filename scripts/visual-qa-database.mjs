export const VISUAL_QA_DATABASE_NAME = "compliance_platform_visual_qa";
export const VISUAL_QA_DATABASE_PORT = "55433";
export const DEFAULT_VISUAL_QA_DATABASE_URL = `postgresql://postgres:postgres@localhost:${VISUAL_QA_DATABASE_PORT}/${VISUAL_QA_DATABASE_NAME}?schema=public`;

export function assertVisualQaDatabaseUrl(databaseUrl, environment = process.env) {
  if (environment.NODE_ENV === "production") throw new Error("Visual-QA database operations are disabled in production.");
  if (!databaseUrl) throw new Error("VISUAL_QA_DATABASE_URL is required.");
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol !== "postgresql:" || !localHosts.has(parsed.hostname) || parsed.port !== VISUAL_QA_DATABASE_PORT || parsed.pathname !== `/${VISUAL_QA_DATABASE_NAME}` || parsed.searchParams.get("schema") !== "public") {
    throw new Error(`Refusing visual-QA database operation: target must be local port ${VISUAL_QA_DATABASE_PORT}, database ${VISUAL_QA_DATABASE_NAME}, schema public.`);
  }
  return databaseUrl;
}

export function visualQaEnvironment(source = process.env) {
  const databaseUrl = assertVisualQaDatabaseUrl(source.VISUAL_QA_DATABASE_URL ?? DEFAULT_VISUAL_QA_DATABASE_URL, source);
  return { ...source, DATABASE_URL: databaseUrl, VISUAL_QA_MODE: "true" };
}
