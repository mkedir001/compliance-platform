import { describe,expect,it,vi } from "vitest";
import { loadSecurePdf,SecurePdfLoadError } from "@/app/admin/clients/pdf-preview-client";

const signal=()=>new AbortController().signal;
const fetcher=(response:Response)=>vi.fn(async()=>response) as unknown as typeof fetch;

describe("secure PDF browser preflight",()=>{
  it("loads an authorized same-origin PDF without exposing its endpoint through a cross-origin request",async()=>{const blob=await loadSecurePdf("/api/organizations/synthetic/documents",signal(),fetcher(new Response("%PDF-synthetic",{headers:{"content-type":"application/pdf"}})));expect(blob.type).toBe("application/pdf");expect(blob.size).toBeGreaterThan(5)});
  it.each([401,403,404,500])("surfaces HTTP %s as a sanitized preview failure",async status=>{const failure=loadSecurePdf("/api/document",signal(),fetcher(new Response("private detail",{status})));await expect(failure).rejects.toMatchObject({name:"SecurePdfLoadError",category:"HTTP",message:"The secure PDF preview could not be loaded."})});
  it("rejects authentication HTML, JSON errors, and invalid or truncated PDF bodies",async()=>{await expect(loadSecurePdf("/api/document",signal(),fetcher(new Response("<html>sign in</html>",{headers:{"content-type":"text/html"}})))).rejects.toMatchObject({category:"CONTENT_TYPE"});await expect(loadSecurePdf("/api/document",signal(),fetcher(Response.json({secret:"not shown"})))).rejects.toMatchObject({category:"CONTENT_TYPE"});await expect(loadSecurePdf("/api/document",signal(),fetcher(new Response("not a pdf",{headers:{"content-type":"application/pdf"}})))).rejects.toMatchObject({category:"INVALID_PDF"})});
  it("fails closed for off-origin URLs",async()=>{await expect(loadSecurePdf("https://example.test/file.pdf",signal())).rejects.toBeInstanceOf(SecurePdfLoadError);await expect(loadSecurePdf("//example.test/file.pdf",signal())).rejects.toMatchObject({category:"INVALID_URL"})});
});
