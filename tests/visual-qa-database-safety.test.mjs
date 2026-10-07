import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DEFAULT_VISUAL_QA_DATABASE_URL, assertVisualQaDatabaseUrl, visualQaEnvironment } from "../scripts/visual-qa-database.mjs";

describe("visual-QA database isolation", () => {
  it("accepts only the dedicated local database identity", () => {
    expect(assertVisualQaDatabaseUrl(DEFAULT_VISUAL_QA_DATABASE_URL,{NODE_ENV:"development"})).toBe(DEFAULT_VISUAL_QA_DATABASE_URL);
    expect(()=>assertVisualQaDatabaseUrl("postgresql://example@production.example.test:5432/app?schema=public",{NODE_ENV:"development"})).toThrow(/Refusing/);
    expect(()=>assertVisualQaDatabaseUrl("postgresql://example@localhost:55432/compliance_platform?schema=public",{NODE_ENV:"development"})).toThrow(/Refusing/);
    expect(()=>assertVisualQaDatabaseUrl(DEFAULT_VISUAL_QA_DATABASE_URL,{NODE_ENV:"production"})).toThrow(/disabled in production/);
  });

  it("forces the application process onto the QA URL and mode", () => {
    expect(visualQaEnvironment({NODE_ENV:"development"})).toEqual(expect.objectContaining({DATABASE_URL:DEFAULT_VISUAL_QA_DATABASE_URL,VISUAL_QA_MODE:"true"}));
  });

  it("keeps integration and visual-QA databases on different ports and volumes", async () => {
    const compose=await readFile("docker-compose.yml","utf8");
    expect(compose).toContain('ports: ["55432:5432"]');
    expect(compose).toContain('ports: ["55433:5432"]');
    expect(compose).toContain("postgres_visual_qa_data");
  });
});
