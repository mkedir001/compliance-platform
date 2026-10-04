import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientDirectoryView } from "@/app/admin/clients/directory-state";

describe("client directory authoritative load state", () => {
  it("shows a legitimate empty state only after a successful zero-result query", () => {
    expect(clientDirectoryView("success", 0)).toBe("empty");
    expect(clientDirectoryView("success", 2)).toBe("results");
  });

  it("shows an error instead of an empty-record state when the authoritative query fails", () => {
    expect(clientDirectoryView("error", 0)).toBe("error");
    expect(clientDirectoryView("loading", 0)).toBe("loading");
    expect(clientDirectoryView("idle", 0)).toBe("loading");
  });

  it("wires the client portal to a recoverable failure state that does not imply data loss", () => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/clients/clients-portal.tsx"), "utf8");
    expect(source).toContain('setDirectoryStatus("error")');
    expect(source).toContain("Client directory unavailable");
    expect(source).toContain("this is not a zero-client result");
    expect(source).toContain("Retry client directory");
  });
});
