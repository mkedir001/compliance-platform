import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { analyzeClientImportPdf } from "@/domain/clients/imports";

// Synthetic documents only. Never add real client forms or names to this repository.
async function linePdf(lines: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  lines.forEach((line, index) => page.drawText(line, { x: 42, y: 740 - index * 22, size: 12, font }));
  return Buffer.from(await pdf.save());
}

const proposal = (result: Awaited<ReturnType<typeof analyzeClientImportPdf>>, fieldPath: string) => result.extracted.find(item => item.fieldPath === fieldPath);

describe("layout-aware extraction in the import pipeline", () => {
  it("maps differently worded labels from a native-text PDF and records confidence", async () => {
    const result = await analyzeClientImportPdf(await linePdf([
      "Radiant Care - Individual Information",
      "Individual needing help:  Jordan Example",
      "Date of birth: 03/08/1990",
      "Legal representative: Sam Guardian",
      "Case manager: Alex Manager",
      "Name and title of person completing this form: Pat Staff, Coordinator",
    ]));
    expect(proposal(result, "identity.fullName")?.value).toBe("Jordan Example");
    expect(proposal(result, "client.legalFirstName")?.value).toBe("Jordan");
    expect(proposal(result, "client.legalLastName")?.value).toBe("Example");
    expect(proposal(result, "client.dateOfBirth")?.value).toBe("03/08/1990");
    expect(proposal(result, "representatives.0.name")?.value).toBe("Sam Guardian");
    expect(proposal(result, "caseManager.name")?.value).toBe("Alex Manager");
    expect(result.extracted.some(item => item.value === "Pat Staff")).toBe(false);
    const name = proposal(result, "client.legalFirstName")!;
    expect(name.confidence).toBeGreaterThan(0.5);
    expect(name.method).toBe("NATIVE_TEXT");
    expect(name.sourceLocation).toContain("Page 1");
    expect(result.semanticMappings.find(item => item.fieldPath === "identity.fullName")?.box).not.toBeNull();
  });

  it("maps values from OCR text that keeps its line breaks", async () => {
    const scan = await PDFDocument.create();
    scan.addPage();
    const result = await analyzeClientImportPdf(Buffer.from(await scan.save()), {
      ocrExecutor: async () => ({
        available: true,
        pages: new Map([[1, "Name of person served: Jordan Example Date of birth: 03/08/1990 Case manager: Alex Manager"]]),
        lines: new Map([[1, ["Name of person served: Jordan Example", "Date of birth: 03/08/1990", "Case manager: Alex Manager"]]]),
        failed: [], skipped: [], durationMs: 5,
        engine: { ocr: "synthetic", renderer: "synthetic" },
        pageResults: [{ pageNumber: 1, status: "PROCESSED", stage: "COMPLETE", durationMs: 5, retryEligible: false, textDetected: true }],
        failureCategory: null, retryEligible: false,
      }),
    });
    expect(proposal(result, "client.legalFirstName")).toMatchObject({ value: "Jordan", method: "LOCAL_OCR" });
    expect(proposal(result, "client.legalLastName")?.value).toBe("Example");
    expect(proposal(result, "caseManager.name")?.value).toBe("Alex Manager");
    expect(proposal(result, "client.legalFirstName")!.confidence).toBeLessThan(1);
  });

  it("still works when OCR text arrives flattened onto one line", async () => {
    const scan = await PDFDocument.create();
    scan.addPage();
    const result = await analyzeClientImportPdf(Buffer.from(await scan.save()), {
      ocrExecutor: async () => ({
        available: true,
        pages: new Map([[1, "Name of person served: Jordan Example Date of development: 7/1/2021 Legal representative: Sam Guardian Case manager: Alex Manager Dates of development: Within 15 days"]]),
        failed: [], skipped: [], durationMs: 5,
        engine: { ocr: "synthetic", renderer: "synthetic" },
        pageResults: [{ pageNumber: 1, status: "PROCESSED", stage: "COMPLETE", durationMs: 5, retryEligible: false, textDetected: true }],
        failureCategory: null, retryEligible: false,
      }),
    });
    expect(proposal(result, "identity.fullName")?.value).toBe("Jordan Example");
    expect(proposal(result, "representatives.0.name")?.value).toBe("Sam Guardian");
    expect(proposal(result, "caseManager.name")?.value).toBe("Alex Manager");
  });

  it("does not override values already found by the exact-match rules", async () => {
    const result = await analyzeClientImportPdf(await linePdf(["Legal first name: Jane Legal last name: Example", "Client name: Different Person"]));
    expect(proposal(result, "client.legalFirstName")?.value).toBe("Jane");
    expect(proposal(result, "client.legalFirstName")?.confidence).toBeUndefined();
  });
});
