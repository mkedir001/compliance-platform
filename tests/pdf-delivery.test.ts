import { describe,expect,it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfResponse } from "@/domain/clients/pdf-response";

async function plainPdf(){const pdf=await PDFDocument.create();pdf.addPage([200,200]);return pdf.save()}
async function formPdf(){const pdf=await PDFDocument.create(),page=pdf.addPage([200,200]);pdf.getForm().createTextField("signature").addToPage(page,{x:20,y:100,width:100,height:20});return pdf.save()}

describe("secure PDF delivery",()=>{
  it("delivers imported originals byte-for-byte with complete defensive headers",async()=>{const original=await plainPdf(),response=await pdfResponse(original,{disposition:"inline",fileName:"source.pdf",previewTransform:"ORIGINAL"}),delivered=new Uint8Array(await response.arrayBuffer());expect(Buffer.from(delivered)).toEqual(Buffer.from(original));expect(response.headers.get("content-type")).toBe("application/pdf");expect(response.headers.get("content-disposition")).toBe('inline; filename="source.pdf"');expect(response.headers.get("content-length")).toBe(String(original.length));expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");expect(response.headers.get("x-content-type-options")).toBe("nosniff")});
  it("flattens generated form renditions only when explicitly requested",async()=>{const response=await pdfResponse(await formPdf(),{disposition:"inline",fileName:"generated.pdf",previewTransform:"FLATTEN_FORM_FIELDS"}),pdf=await PDFDocument.load(await response.arrayBuffer());expect(pdf.getForm().getFields()).toHaveLength(0);expect(pdf.getPageCount()).toBe(1)});
  it("downloads the authoritative bytes independently without a preview transform",async()=>{const original=await formPdf(),response=await pdfResponse(original,{disposition:"attachment",fileName:'signed"copy.pdf',previewTransform:"FLATTEN_FORM_FIELDS"});expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(original));expect(response.headers.get("content-disposition")).toBe('attachment; filename="signed_copy.pdf"')});
  it("rejects non-PDF storage bytes instead of returning a broken preview",async()=>{await expect(pdfResponse(new Uint8Array([1,2,3]),{disposition:"inline",fileName:"bad.pdf"})).rejects.toThrow(/unavailable/i)});
});
