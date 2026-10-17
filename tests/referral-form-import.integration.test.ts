import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { analyzeClientImportPdf } from "@/domain/clients/imports";

describe("referral form through the PDF import", () => {
  it("is applied by the PDF import for a fillable referral form", async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]), form = pdf.getForm();
    ["client_name", "client_dob", "client_phone", "medicaid_number", "case_manager_name"].forEach((name, index) => { const field = form.createTextField(name); field.setText({ client_name: "Jordan Example", client_dob: "4/16/2005", client_phone: "Pat-507-555-0101", medicaid_number: "01234567", case_manager_name: "Sam Manager" }[name]!); field.addToPage(page, { x: 20, y: 700 - index * 30, width: 200, height: 20 }); });
    const box = form.createCheckBox("svc_ihs_with_training"); box.check(); box.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });
    const result = await analyzeClientImportPdf(Buffer.from(await pdf.save()), { ocrExecutor: async () => ({ available: false, pages: new Map(), failed: [], skipped: [], durationMs: 0, engine: { ocr: "", renderer: "" }, pageResults: [], failureCategory: null, retryEligible: false }) });
    const paths = JSON.stringify(result);
    for (const path of ["client.legalFirstName", "client.legalLastName", "client.dateOfBirth", "client.phone", "client.maPmiNumber", "services.types.IHS_WITH_TRAINING", "caseManager.name"]) expect(paths).toContain(path);
  });
});
