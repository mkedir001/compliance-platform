import { ResourceNotFoundError } from "@/domain/auth/errors";
import { previewPdfBytes } from "@/domain/clients/pdf-preview";

export type PdfPreviewTransform="ORIGINAL"|"FLATTEN_FORM_FIELDS";

export async function pdfResponse(bytes:Uint8Array,options:{disposition:"inline"|"attachment";fileName:string;previewTransform?:PdfPreviewTransform}){
  if(bytes.length<5||Buffer.from(bytes.subarray(0,5)).toString("ascii")!=="%PDF-")throw new ResourceNotFoundError("Document PDF unavailable");
  const delivered=options.disposition==="inline"&&options.previewTransform==="FLATTEN_FORM_FIELDS"?await previewPdfBytes(bytes):bytes;
  const body=new Uint8Array(delivered),fileName=options.fileName.replace(/["\\\r\n]/g,"_");
  return new Response(body,{headers:{"content-type":"application/pdf","content-disposition":`${options.disposition}; filename="${fileName}"`,"content-length":String(body.byteLength),"cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"}});
}
