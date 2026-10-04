import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const COMPONENT_KEYS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_SSL_MODE", "DB_USERNAME", "DB_PASSWORD"];
const SAFE_COMPONENT = /^[A-Za-z0-9_-]+$/;
const SAFE_HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;

export class DatabaseStartupConfigurationError extends Error {
  constructor(code) {
    super(`Production database startup configuration is invalid (${code})`);
    this.name = "DatabaseStartupConfigurationError";
  }
}

function required(source, key) {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new DatabaseStartupConfigurationError(`missing-${key.toLowerCase()}`);
  return value;
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildDatabaseUrl(source) {
  const host = required(source, "DB_HOST");
  const portSource = required(source, "DB_PORT");
  const database = required(source, "DB_NAME");
  const sslMode = required(source, "DB_SSL_MODE");
  const username = required(source, "DB_USERNAME");
  const password = required(source, "DB_PASSWORD");
  const port = Number(portSource);

  if (!SAFE_HOST.test(host)) throw new DatabaseStartupConfigurationError("invalid-db_host");
  if (!/^\d{1,5}$/.test(portSource) || !Number.isInteger(port) || port < 1 || port > 65535) throw new DatabaseStartupConfigurationError("invalid-db_port");
  if (!SAFE_COMPONENT.test(database)) throw new DatabaseStartupConfigurationError("invalid-db_name");
  if (sslMode !== "require") throw new DatabaseStartupConfigurationError("invalid-db_ssl_mode");

  return `postgresql://${encode(username)}:${encode(password)}@${host}:${port}/${encode(database)}?sslmode=require`;
}

export function productionApplicationEnvironment(source = process.env) {
  const environment = { ...source, DATABASE_URL: buildDatabaseUrl(source) };
  for (const key of COMPONENT_KEYS) delete environment[key];
  return environment;
}

export function startProductionApplication({ source = process.env, spawnImpl = spawn, command = ["pnpm", "start"] } = {}) {
  let environment;
  try {
    environment = productionApplicationEnvironment(source);
  } catch (error) {
    const message = error instanceof DatabaseStartupConfigurationError ? error.message : "Production database startup configuration is invalid";
    console.error(message);
    return 78;
  }

  if (!Array.isArray(command) || command.length === 0 || command.some(value => typeof value !== "string" || value.length === 0)) {
    console.error("Production application command is invalid");
    return 64;
  }
  const child = spawnImpl(command[0], command.slice(1), { env: environment, stdio: "inherit" });
  child.once("error", () => {
    console.error("Production application process failed to start");
    process.exitCode = 70;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = typeof code === "number" ? code : signal ? 1 : 0;
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = startProductionApplication({ command: process.argv.length > 2 ? process.argv.slice(2) : ["pnpm", "start"] });
  if (typeof result === "number") process.exitCode = result;
}
