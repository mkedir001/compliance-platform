import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Synthetic, blank documents only.
async function blankPdf(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) pdf.addPage();
  return Buffer.from(await pdf.save());
}
const engine = { available: true, ocr: "synthetic", renderer: "synthetic" };

describe("bounded-parallel OCR and resuming unread pages", () => {
  it("reads several pages at once, within the concurrency limit, and reports them in page order", async () => {
    vi.resetModules();
    vi.stubEnv("CLIENT_IMPORT_OCR_CONCURRENCY", "2");
    const { analyzeClientImportPdf } = await import("@/domain/clients/imports");
    let active = 0, peak = 0;
    const result = await analyzeClientImportPdf(await blankPdf(4), {
      ocrEngine: engine,
      processRunner: async (command, args) => {
        if (command === "pdftoppm") { await writeFile(`${args.at(-1)}.jpg`, Buffer.from("img")); return ""; }
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 20));
        active--;
        return `Readable text for ${String(args[0]).match(/page-(\d+)/)?.[1]}`;
      },
    });
    vi.unstubAllEnvs();
    expect(peak).toBe(2);
    expect(result.extractionStatus).toBe("OCR_COMPLETED");
    expect(result.diagnostics.pageResults.map(item => item.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(result.textPages.map(page => page.text)).toEqual([1, 2, 3, 4].map(n => `Readable text for ${n}`));
  });

  it("only reads the pages an earlier attempt could not, and keeps the pages it already had", async () => {
    vi.resetModules();
    const { analyzeClientImportPdf } = await import("@/domain/clients/imports");
    const requested: number[][] = [];
    const result = await analyzeClientImportPdf(await blankPdf(4), {
      priorOcrPages: new Map([[1, "Earlier page one"], [2, "Earlier page two"], [3, "Earlier page three"]]),
      ocrExecutor: async (_bytes, pageNumbers) => {
        requested.push(pageNumbers);
        return {
          available: true, pages: new Map([[4, "Newly read page four"]]), failed: [], skipped: [], durationMs: 1, engine,
          pageResults: [{ pageNumber: 4, status: "PROCESSED", stage: "COMPLETE", durationMs: 1, retryEligible: false, textDetected: true }],
          failureCategory: null, retryEligible: false,
        };
      },
    });
    expect(requested).toEqual([[4]]);
    expect(result.extractionStatus).toBe("OCR_COMPLETED");
    expect(result.textPages.map(page => page.text)).toEqual(["Earlier page one", "Earlier page two", "Earlier page three", "Newly read page four"]);
    expect(result.diagnostics.skippedPageCount).toBe(0);
  });

  it("stays incomplete when a page still cannot be read, so the retry stays available", async () => {
    vi.resetModules();
    const { analyzeClientImportPdf } = await import("@/domain/clients/imports");
    const result = await analyzeClientImportPdf(await blankPdf(2), {
      priorOcrPages: new Map([[1, "Earlier page one"]]),
      ocrExecutor: async () => ({
        available: true, pages: new Map(), failed: [], skipped: [2], durationMs: 1, engine,
        pageResults: [{ pageNumber: 2, status: "SKIPPED", stage: "BUDGET", durationMs: 0, failureCategory: "DOCUMENT_BUDGET_EXCEEDED", retryEligible: true }],
        failureCategory: "DOCUMENT_BUDGET_EXCEEDED", retryEligible: true,
      }),
    });
    expect(result.extractionStatus).toBe("OCR_REQUIRED");
    expect(result.diagnostics.retryEligible).toBe(true);
    expect(result.textPages[0].text).toBe("Earlier page one");
  });
});
