export type ImportApiErrorCategory="AUTHENTICATION_REQUIRED"|"REQUEST_TOO_LARGE"|"AMBIGUOUS_OUTCOME"|"STRUCTURED_ERROR";

export class ImportApiError extends Error{
  constructor(message:string,readonly category:ImportApiErrorCategory,readonly outcomeUnknown=false,readonly status?:number){super(message);this.name="ImportApiError"}
}

function structuredMessage(value:unknown,fallback:string){if(!value||typeof value!=="object")return fallback;const body=value as{error?:unknown;details?:unknown},detail=Array.isArray(body.details)?body.details.flatMap(item=>item&&typeof item==="object"&&"message" in item&&typeof item.message==="string"?[item.message]:[]).join("; "):"";return detail||typeof body.error==="string"&&body.error||fallback}

export async function readImportApiResponse<T>(response:Response):Promise<T>{
  if(response.redirected||response.status>=300&&response.status<400||response.status===401)throw new ImportApiError("Your session may have expired. Sign in again and check whether the documents were uploaded.","AUTHENTICATION_REQUIRED",true,response.status);
  if(response.status===413)throw new ImportApiError("The selected files are too large for one upload. Your existing documents have been preserved.","REQUEST_TOO_LARGE",false,response.status);
  const contentType=response.headers.get("content-type")?.toLowerCase()??"",isJson=contentType.includes("application/json")||contentType.includes("+json");
  if(!isJson){const unknown=response.ok||[408,425,429,499,502,503,504].includes(response.status);throw new ImportApiError(unknown?"The server outcome could not be confirmed. Check this import before retrying; successfully uploaded documents will be preserved.":"The upload could not be completed. Your existing documents have been preserved.",unknown?"AMBIGUOUS_OUTCOME":"STRUCTURED_ERROR",unknown,response.status)}
  let body:unknown;try{body=await response.json()}catch{throw new ImportApiError("The server outcome could not be confirmed. Check this import before retrying; successfully uploaded documents will be preserved.","AMBIGUOUS_OUTCOME",true,response.status)}
  if(!response.ok)throw new ImportApiError(structuredMessage(body,"The upload operation could not be completed."),"STRUCTURED_ERROR",false,response.status);
  return body as T;
}

export function importNetworkError(){return new ImportApiError("The connection ended before the server outcome was confirmed. Check this import before retrying.","AMBIGUOUS_OUTCOME",true)}
