import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, rgb } from "pdf-lib";
import { previewPdfBytes } from "@/domain/clients/pdf-preview";

async function signedForm() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([300, 200]);
  pdf.getForm().createTextField("signature").addToPage(page, { x: 20, y: 100, width: 200, height: 30, borderWidth: 0 });
  page.drawLine({ start: { x: 30, y: 100 }, end: { x: 200, y: 135 }, thickness: 2, color: rgb(0, 0, 0) });
  return pdf.save();
}

describe("previewPdfBytes", () => {
  it("flattens fillable fields so nothing is painted over a signature", async () => {
    const original = await signedForm();
    expect((await PDFDocument.load(original)).getForm().getFields()).toHaveLength(1);
    const preview = await PDFDocument.load(await previewPdfBytes(original));
    expect(preview.getForm().getFields()).toHaveLength(0);
    expect(preview.getPageCount()).toBe(1);
    const annots = preview.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    expect(annots?.size() ?? 0).toBe(0);
  });
  it("returns PDFs without form fields, and unreadable input, unchanged", async () => {
    const plain = await PDFDocument.create(); plain.addPage();
    const bytes = await plain.save();
    expect(await previewPdfBytes(bytes)).toBe(bytes);
    const junk = new Uint8Array([1, 2, 3]);
    expect(await previewPdfBytes(junk)).toBe(junk);
  });
  it("never changes the stored bytes it was given", async () => {
    const original = await signedForm(), copy = Uint8Array.from(original);
    await previewPdfBytes(original);
    expect(Buffer.from(original).equals(Buffer.from(copy))).toBe(true);
  });
});
