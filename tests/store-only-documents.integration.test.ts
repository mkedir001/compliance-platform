import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PrismaClient, type Prisma } from "@prisma/client";
import { confirmClientImport, processClientImportDocument, reviewClientImportProposal, stageClientImport, startCareProfileFromStoredDocuments, storeClientDocuments } from "@/domain/clients/imports";

const db = new PrismaClient();
const analysis = (extracted: Array<{ fieldPath: string; value: Prisma.InputJsonValue }>) => ({ classification: "SMA", ocrRequired: false, extractionStatus: "TEXT_EXTRACTED", method: "NATIVE_TEXT", pageCount: 1, text: "synthetic", rawFields: {}, textPages: [{ pageNumber: 1, text: "synthetic", method: "NATIVE_TEXT" }], pagesRequiringOcr: [], ocr: null, semanticMappings: [], diagnostics: { stage: "COMPLETE", mappedProposalCount: extracted.length }, signals: ["synthetic"], extracted: extracted.map((item, index) => ({ ...item, sourceLocation: `Page 1 row ${index + 1}`, method: "NATIVE_TEXT", confidence: 0.7 })) });
async function pdf(marker: string) { const value = await PDFDocument.create(); value.addPage(); value.setTitle(marker); return Buffer.from(await value.save()); }
const file = async (name: string, marker: string) => ({ fileName: name, mimeType: "application/pdf" as const, pdfBase64: (await pdf(marker)).toString("base64") });

describe.sequential("store-only uploads and care-profile-only reviews", () => {
  let organizationId: string, otherOrganizationId: string, userId: string, clientId: string;
  beforeAll(async () => {
    const tag = `store-only-${Date.now()}`;
    const [organization, other, user] = await Promise.all([db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }), db.organization.create({ data: { legalName: `${tag}-o`, displayName: `${tag}-o`, slug: `${tag}-o` } }), db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } })]);
    organizationId = organization.id; otherOrganizationId = other.id; userId = user.id;
    for (const code of ["client.read", "client.update"]) await db.permission.upsert({ where: { code }, update: {}, create: { code } });
    const role = await db.roleDefinition.create({ data: { organizationId, code: "STORE_ONLY_TESTER", name: "Tester", scope: "ORGANIZATION", permissions: { create: (await db.permission.findMany({ where: { code: { in: ["client.read", "client.update"] } } })).map(permission => ({ permissionId: permission.id })) } } });
    await db.organizationMembership.create({ data: { organizationId, userId, status: "ACTIVE", roles: { create: { roleDefinitionId: role.id } } } });
    clientId = (await db.client.create({ data: { organizationId, legalFirstName: "Synthetic", legalLastName: "Client", phone: "555-0100", createdByUserId: userId } })).id;
  });

  it("stores PDFs on the Documents tab without a session, extraction or any client change, and skips duplicates", async () => {
    const files = [await file("Annual Plan 2026.pdf", "a"), await file("Assessment.pdf", "b")];
    const result = await storeClientDocuments({ id: userId }, organizationId, clientId, { files });
    expect(result.documentIds).toHaveLength(2);
    const documents = await db.clientDocument.findMany({ where: { id: { in: result.documentIds } } });
    expect(documents.map(item => item.displayName).sort()).toEqual(["Annual Plan 2026", "Assessment"]);
    expect(documents.every(item => item.source === "IMPORTED" && item.renderedPdf && item.status === "DRAFT")).toBe(true);
    expect((documents[0].snapshotJson as Record<string, unknown>).storedWithoutExtraction).toBe(true);
    expect(await db.clientImportSession.count({ where: { organizationId, existingClientId: clientId } })).toBe(0);
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ phone: "555-0100", legalFirstName: "Synthetic" });
    const again = await storeClientDocuments({ id: userId }, organizationId, clientId, { files: [files[0]] });
    expect(again.documentIds).toHaveLength(0);
    expect(again.duplicateFileNames).toEqual(["Annual Plan 2026.pdf"]);
    expect(await db.auditEvent.count({ where: { organizationId, eventType: "client.documents_stored_without_extraction" } })).toBe(2);
  });

  it("refuses another organization's client", async () => {
    await expect(storeClientDocuments({ id: userId }, otherOrganizationId, clientId, { files: [await file("x.pdf", "x")] })).rejects.toThrow();
  });

  it("reviews a stored document for the care profile only, without duplicating it or changing client records", async () => {
    const stored = await db.clientDocument.findFirstOrThrow({ where: { organizationId, clientId, displayName: "Assessment" } });
    const before = await db.clientDocument.count({ where: { organizationId, clientId } });
    const started = await startCareProfileFromStoredDocuments({ id: userId }, organizationId, clientId, { documentIds: [stored.id] });
    expect(started.scope).toBe("CARE_PROFILE_ONLY");
    await expect(startCareProfileFromStoredDocuments({ id: userId }, organizationId, clientId, { documentIds: ["c000000000000000000000000"] })).rejects.toThrow();
    let current = await processClientImportDocument({ id: userId }, organizationId, started.id, started.documents[0].id, { analyze: async () => analysis([{ fieldPath: "care.waterSafetySkills", value: { label: "Water safety skills", answer: "YES", detail: "Staff nearby", note: "" } }, { fieldPath: "client.phone", value: "555-9999" }, { fieldPath: "health.diagnoses", value: "Should be ignored" }]) as never });
    const care = current.proposals.find(item => item.fieldPath === "care.waterSafetySkills")!;
    await reviewClientImportProposal({ id: userId }, organizationId, started.id, { proposalId: care.id, state: "ACCEPTED" });
    // the phone and diagnosis proposals are intentionally left unreviewed: they are out of scope
    const result = await confirmClientImport({ id: userId }, organizationId, started.id, { confirmed: true, target: "UPDATE_EXISTING", clientId, documents: [{ documentId: started.documents[0].id, disposition: "PRESERVE_ONLY", signatureReviewStatus: "UNREVIEWED", validityReviewStatus: "UNREVIEWED" }] });
    expect(result.createdDocuments).toEqual([]);
    expect(await db.clientDocument.count({ where: { organizationId, clientId } })).toBe(before);
    const updated = await db.clientDocument.findUniqueOrThrow({ where: { id: stored.id } });
    expect((updated.snapshotJson as { reviewedFacts: Array<{ fieldPath: string }> }).reviewedFacts.map(item => item.fieldPath)).toContain("care.waterSafetySkills");
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ phone: "555-0100" });
    expect(await db.clientHealthProfile.findUnique({ where: { clientId } })).toBeNull();
  });

  it("limits a fresh extraction upload to the care profile when requested, and rejects the scope for new clients", async () => {
    await expect(stageClientImport({ id: userId }, organizationId, { target: "CREATE_NEW", scope: "CARE_PROFILE_ONLY", files: [await file("n.pdf", "n")] })).rejects.toThrow(/existing client/);
    const session = await stageClientImport({ id: userId }, organizationId, { target: "UPDATE_EXISTING", existingClientId: clientId, scope: "CARE_PROFILE_ONLY", files: [await file("fresh.pdf", "f")] });
    expect(session.scope).toBe("CARE_PROFILE_ONLY");
  });
});
