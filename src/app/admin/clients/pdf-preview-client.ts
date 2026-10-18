export class SecurePdfLoadError extends Error{
  constructor(public readonly category:"INVALID_URL"|"HTTP"|"CONTENT_TYPE"|"INVALID_PDF"){super("The secure PDF preview could not be loaded.");this.name="SecurePdfLoadError"}
}

export async function loadSecurePdf(src:string,signal:AbortSignal,fetcher:typeof fetch=fetch){
  if(!src.startsWith("/")||src.startsWith("//"))throw new SecurePdfLoadError("INVALID_URL");
  let response:Response;
  try{response=await fetcher(src,{method:"GET",credentials:"same-origin",cache:"no-store",headers:{accept:"application/pdf"},signal})}catch(error){if(error instanceof DOMException&&error.name==="AbortError")throw error;throw new SecurePdfLoadError("HTTP")}
  if(!response.ok)throw new SecurePdfLoadError("HTTP");
  if(!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf"))throw new SecurePdfLoadError("CONTENT_TYPE");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw new SecurePdfLoadError("INVALID_PDF");
  return new Blob([bytes],{type:"application/pdf"});
}
