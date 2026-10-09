import { describe, expect, it } from "vitest";
import { ImportApiError, importNetworkError, readImportApiResponse } from "@/app/admin/clients/import-response";

describe("client import API response safety",()=>{
  it("returns successful JSON without assuming every response is JSON",async()=>{await expect(readImportApiResponse<{ok:boolean}>(Response.json({ok:true},{status:202}))).resolves.toEqual({ok:true})});
  it("preserves structured API errors",async()=>{await expect(readImportApiResponse(Response.json({error:"Synthetic validation failure"},{status:422}))).rejects.toMatchObject({message:"Synthetic validation failure",category:"STRUCTURED_ERROR",status:422})});
  it.each([502,503,504])("classifies HTML %s responses as ambiguous without exposing parser text",async status=>{let captured:unknown;try{await readImportApiResponse(new Response("<html><h1>Gateway response</h1></html>",{status,headers:{"content-type":"text/html"}}))}catch(error){captured=error}expect(captured).toBeInstanceOf(ImportApiError);expect(captured).toMatchObject({category:"AMBIGUOUS_OUTCOME",outcomeUnknown:true,status});expect(String((captured as Error).message)).not.toMatch(/Unexpected token|<html>/)});
  it("classifies redirects as authentication recovery",async()=>{await expect(readImportApiResponse(new Response(null,{status:302,headers:{location:"https://synthetic.invalid/login"}}))).rejects.toMatchObject({category:"AUTHENTICATION_REQUIRED",outcomeUnknown:true,status:302})});
  it("classifies an expired authenticated request without exposing its response",async()=>{await expect(readImportApiResponse(new Response("unauthorized",{status:401,headers:{"content-type":"text/html"}}))).rejects.toMatchObject({category:"AUTHENTICATION_REQUIRED",outcomeUnknown:true,status:401})});
  it("gives request-size failures an actionable bounded message",async()=>{await expect(readImportApiResponse(new Response("too large",{status:413,headers:{"content-type":"text/html"}}))).rejects.toMatchObject({category:"REQUEST_TOO_LARGE",outcomeUnknown:false,status:413})});
  it("treats an empty or malformed successful response as unknown outcome",async()=>{await expect(readImportApiResponse(new Response("",{status:200,headers:{"content-type":"application/json"}}))).rejects.toMatchObject({category:"AMBIGUOUS_OUTCOME",outcomeUnknown:true})});
  it("treats network interruption or request cancellation as an ambiguous outcome",()=>{expect(importNetworkError()).toMatchObject({category:"AMBIGUOUS_OUTCOME",outcomeUnknown:true})});
});
