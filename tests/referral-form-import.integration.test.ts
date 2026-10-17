import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { analyzeClientImportPdf, confirmClientImport, createClientImport, reviewClientImportProposal } from "@/domain/clients/imports";

const db = new PrismaClient();

async function referralPdf() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]), form = pdf.getForm();
  const values = { client_name: "Jordan Example", client_dob: "4/16/2005", client_phone: "Pat-507-555-0101", medicaid_number: "01234567", case_manager_name: "Sam Manager" };
  Object.entries(values).forEach(([name, value], index) => { const field = form.createTextField(name); field.setText(value); field.addToPage(page, { x: 20, y: 700 - index * 30, width: 200, height: 20 }); });
  const box = form.createCheckBox("svc_ihs_with_training"); box.check(); box.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });
  return Buffer.from(await pdf.save());
}

describe("referral form through the PDF import", () => {
  it("is applied by the PDF import for a fillable referral form", async () => {
    const result = await analyzeClientImportPdf(await referralPdf(), { ocrExecutor: async () => ({ available: false, pages: new Map(), failed: [], skipped: [], durationMs: 0, engine: { ocr: "", renderer: "" }, pageResults: [], failureCategory: null, retryEligible: false }) });
    const paths = JSON.stringify(result);
    for (const path of ["client.legalFirstName", "client.legalLastName", "client.dateOfBirth", "client.phone", "client.maPmiNumber", "services.types.IHS_WITH_TRAINING", "caseManager.name"]) expect(paths).toContain(path);
  });
});

describe.sequential("referral form proposal persistence", () => {
  let organizationId = "", ownerId = "";
  const owner = () => ({ id: ownerId });

  beforeAll(async () => {
    const tag = `referral-import-${Date.now()}`;
    const [organization, user, role] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.user.create({ data: { email: `${tag}@example.test`, status: "ACTIVE" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } })
    ]);
    organizationId = organization.id; ownerId = user.id;
    const membership = await db.organizationMembership.create({ data: { organizationId, userId: ownerId, status: "ACTIVE" } });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: role.id } });
  });

  it("persists only reviewed referral proposals and keeps the original document", async () => {
    const pdf = await referralPdf();
    let session = await createClientImport(owner(), organizationId, { target: "CREATE_NEW", files: [{ fileName: "synthetic-referral.pdf", mimeType: "application/pdf", pdfBase64: pdf.toString("base64") }] });
    expect(await db.client.count({ where: { organizationId } })).toBe(0);
    for (const proposal of session.proposals) session = await reviewClientImportProposal(owner(), organizationId, session.id, { proposalId: proposal.id, state: "ACCEPTED" });
    const result = await confirmClientImport(owner(), organizationId, session.id, { confirmed: true, target: "CREATE_NEW", documents: session.documents.map(document => ({ documentId: document.id, disposition: "PRESERVE_ONLY" })) });
    const [client, services, document] = await Promise.all([
      db.client.findUniqueOrThrow({ where: { id: result.clientId } }),
      db.clientService.findMany({ where: { organizationId, clientId: result.clientId } }),
      db.clientDocument.findFirstOrThrow({ where: { organizationId, clientId: result.clientId, originalFileName: "synthetic-referral.pdf" } })
    ]);
    expect(client).toMatchObject({ legalFirstName: "Jordan", legalLastName: "Example", maPmiNumber: "01234567" });
    expect(client.dateOfBirth?.toISOString().slice(0, 10)).toBe("2005-04-16");
    expect(services.map(service => service.serviceType)).toContain("IHS_WITH_TRAINING");
    expect(document).toMatchObject({ source: "IMPORTED", status: "DRAFT" });
    expect(Buffer.from(document.renderedPdf!)).toEqual(pdf);
  });
});
