import { describe, expect, it } from "vitest";
import { CLIENT_IMPORT_MAX_FILE_BYTES, createImportInput, validateClientImportPdfEnvelope } from "@/domain/clients/imports";
import { classifyDocumentText, clientDocumentRegistry } from "@/domain/clients/document-registry";

describe("intelligent client document intake foundation",()=>{
  it("registers every supported category and stable type without changing legacy identifiers",()=>{
    expect(clientDocumentRegistry.map(item=>item.id)).toEqual(expect.arrayContaining(["INTAKE_CHECKLIST","FACE_SHEET","RIGHTS_ACKNOWLEDGMENT","ROI","ADMISSION_FORM","RIGHTS_OF_PERSONS_SERVED","CSSP","CSSP_ADDENDUM","CSSP_SIGNATURE_PAGE","COUNTY_SUPPORT_PLAN","IAPP","SMA","SMA_SIGNATURE_PAGE","SERVICE_AGREEMENT_LETTER","SERVICE_AUTHORIZATION","OTHER","UNKNOWN"]));
    expect(new Set(clientDocumentRegistry.map(item=>item.category))).toEqual(new Set(["INTAKE","RIGHTS_AND_CONSENT","SUPPORT_PLANNING","ASSESSMENTS","SERVICE_AUTHORIZATION","GENERAL"]));
  });

  it.each([
    ["Admission Form","ADMISSION_FORM"],["Rights of Persons Served","RIGHTS_OF_PERSONS_SERVED"],["CSSP Addendum","CSSP_ADDENDUM"],["CSSP Signature Page","CSSP_SIGNATURE_PAGE"],["County Support Plan","COUNTY_SUPPORT_PLAN"],["Individual Abuse Prevention Plan (IAPP)","IAPP"],["Self-Management Assessment","SMA"],["SMA Signature Page","SMA_SIGNATURE_PAGE"],["Service Agreement Letter","SERVICE_AGREEMENT_LETTER"],["Service Authorization","SERVICE_AUTHORIZATION"],
  ])("classifies the explicit label %s",(text,expected)=>expect(classifyDocumentText(text).classification).toBe(expected));

  it("accepts server-side PDF envelopes above 10 MB through 25 MB and rejects larger or spoofed files",()=>{
    expect(validateClientImportPdfEnvelope(Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(10_500_000)])).fileSize).toBeGreaterThan(10_000_000);
    expect(validateClientImportPdfEnvelope(Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(CLIENT_IMPORT_MAX_FILE_BYTES-5)])).fileSize).toBe(CLIENT_IMPORT_MAX_FILE_BYTES);
    expect(()=>validateClientImportPdfEnvelope(Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(CLIENT_IMPORT_MAX_FILE_BYTES)])).fileSize).toThrow(/25 MB/);
    expect(()=>validateClientImportPdfEnvelope(Buffer.from("not a pdf"))).toThrow(/valid PDF/);
    expect(()=>createImportInput.parse({target:"CREATE_NEW",files:[{fileName:"unsafe.pdf",mimeType:"text/plain",pdfBase64:"JVBERi0="}]})).toThrow();
  });
});
