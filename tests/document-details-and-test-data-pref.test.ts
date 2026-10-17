import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("document details and signed status", () => {
  const portal = read("src/app/admin/clients/clients-portal.tsx");
  const route = read("src/app/api/organizations/[organizationId]/clients/[clientId]/documents/route.ts");
  const domain = read("src/domain/clients/documents.ts");

  it("exposes per-document name, expiration and mark-signed actions", () => {
    expect(route).toContain('"UPDATE_DETAILS"');
    expect(route).toContain('"MARK_SIGNED"');
    expect(portal).toContain("DocumentDetailsPanel");
    expect(portal).toContain("Mark as signed");
  });
  it("shows the custom name everywhere and reads imported completed documents as signed", () => {
    expect(portal).toContain("documentName(selectedDocument)");
    expect(portal).toMatch(/source==="IMPORTED"&&document\.status==="COMPLETED"[^;]*return"SIGNED_CURRENT"/);
  });
  it("limits mark-signed to imported documents without a signature workflow and audits it", () => {
    expect(domain).toContain("client.document_marked_signed");
    expect(domain).toContain("client.document_details_updated");
    expect(domain).toContain("platformVerified: false");
  });
  it("keeps the migration additive and date-only", () => {
    const migration = read("prisma/migrations/20261017180000_client_document_name_expiration/migration.sql");
    expect(migration).toContain('ADD COLUMN "displayName" TEXT');
    expect(migration).toContain('ADD COLUMN "expirationDate" DATE');
    expect(migration).not.toMatch(/DROP|DELETE|UPDATE|TRUNCATE/i);
  });
});

describe("test data visibility preference", () => {
  const clients = read("src/app/admin/clients/clients-portal.tsx");
  const ops = read("src/app/admin/operations-portal.tsx");
  const settings = read("src/app/admin/setup/test-data-cleanup/test-data-cleanup-portal.tsx");

  it("removes the toolbar checkbox and uses the shared preference", () => {
    expect(clients).not.toContain("Show test data</label>");
    expect(clients).toContain("useShowTestData");
    expect(ops).toContain("useShowTestData");
    expect(ops).not.toContain("Organization administrators can temporarily include");
  });
  it("offers the platform-wide toggle in Test Data Management", () => {
    expect(settings).toContain("Show test data across the platform");
    expect(ops).toContain("Test data included:");
    expect(clients).toContain("Test data</StatusChip>");
  });
});
