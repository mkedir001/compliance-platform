import { describe, expect, it, vi } from "vitest";
import { buildDatabaseUrl, DatabaseStartupConfigurationError, productionApplicationEnvironment, startProductionApplication } from "../scripts/start-production.mjs";

const components = {
  DB_HOST: "compliance-platform-prod-db.example.us-east-2.rds.amazonaws.com",
  DB_PORT: "5432",
  DB_NAME: "compliance_platform",
  DB_SSL_MODE: "require",
  DB_USERNAME: "platform_user",
  DB_PASSWORD: "synthetic-password",
};

describe("production database startup", () => {
  it("constructs the required TLS PostgreSQL URL and removes injected components from the child environment", () => {
    expect(buildDatabaseUrl(components)).toBe("postgresql://platform_user:synthetic-password@compliance-platform-prod-db.example.us-east-2.rds.amazonaws.com:5432/compliance_platform?sslmode=require");
    const environment = productionApplicationEnvironment({ ...components, NODE_ENV: "production", APP_BASE_URL: "https://app.example.test", DATABASE_URL: "postgresql://stale-copy" });
    expect(environment.DATABASE_URL).toBe(buildDatabaseUrl(components));
    expect(environment).not.toHaveProperty("DB_USERNAME");
    expect(environment).not.toHaveProperty("DB_PASSWORD");
  });

  it("percent-encodes every reserved username and password character", () => {
    const url = buildDatabaseUrl({ ...components, DB_USERNAME: "user@:/?#%&", DB_PASSWORD: "pass@:/?#%&" });
    expect(url).toContain("user%40%3A%2F%3F%23%25%26:pass%40%3A%2F%3F%23%25%26@");
    expect(new URL(url).username).toBe("user%40%3A%2F%3F%23%25%26");
  });

  it.each([
    ["missing username", { ...components, DB_USERNAME: "" }],
    ["missing password", { ...components, DB_PASSWORD: "" }],
    ["malformed host", { ...components, DB_HOST: "host/with/path" }],
    ["malformed port", { ...components, DB_PORT: "70000" }],
    ["malformed database", { ...components, DB_NAME: "name/other" }],
    ["weakened SSL", { ...components, DB_SSL_MODE: "prefer" }],
  ])("fails closed for %s", (_name, source) => {
    expect(() => buildDatabaseUrl(source)).toThrow(DatabaseStartupConfigurationError);
  });

  it("does not fall back to an existing DATABASE_URL or expose component values on startup failure", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spawn = vi.fn();
    expect(startProductionApplication({ source: { ...components, NODE_ENV: "production", DB_PASSWORD: "", DATABASE_URL: "postgresql://stale-secret" }, spawnImpl: spawn as never })).toBe(78);
    expect(spawn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/invalid|missing/i));
    expect(JSON.stringify(error.mock.calls)).not.toContain("stale-secret");
    error.mockRestore();
  });

  it("can wrap a production migration or operational command with the same constructed environment", () => {
    const child = { once: vi.fn(), kill: vi.fn() };
    const spawn = vi.fn(() => child);
    expect(startProductionApplication({ source: { ...components, NODE_ENV: "production" }, spawnImpl: spawn as never, command: ["pnpm", "db:deploy"] })).toBe(child);
    expect(spawn).toHaveBeenCalledWith("pnpm", ["db:deploy"], expect.objectContaining({ env: expect.objectContaining({ DATABASE_URL: buildDatabaseUrl(components) }) }));
  });
});
