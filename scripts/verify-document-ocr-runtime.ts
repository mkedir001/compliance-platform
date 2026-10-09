import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { analyzeClientImportPdf } from "../src/domain/clients/imports";

const execute=promisify(execFile);

async function syntheticScan({pageCount=1,width=900,height=500,quality=85,rotated=false}:{pageCount?:number;width?:number;height?:number;quality?:number;rotated?:boolean}={}){
  const directory=await mkdtemp(join(tmpdir(),"ocr-runtime-check-"));
  try{
    const source=await PDFDocument.create(),font=await source.embedFont(StandardFonts.TimesRoman);
    for(let index=0;index<pageCount;index++){const page=source.addPage([width,height]);if(rotated&&index===pageCount-1)page.setRotation(degrees(90));page.drawText(index===0?"Admission Form":"Synthetic continuation page",{x:45,y:height-55,size:24,font});page.drawText(index===0?"Legal first name: Jane":"Document page with readable synthetic text",{x:45,y:height-110,size:22,font});page.drawText(index===0?"Legal last name: Example":"No protected health information",{x:45,y:height-155,size:22,font});page.drawText(index===0?"Date of birth: 01/15/1990":"Bounded OCR runtime verification",{x:45,y:height-200,size:22,font});page.drawText(index===0?"Address: 123 Example Street":"End of synthetic page",{x:45,y:height-245,size:22,font});if(index===0){page.drawText("Phone: 555-0100",{x:45,y:height-290,size:22,font});page.drawText("Case manager: Alex Sample",{x:45,y:height-335,size:22,font})}}
    const sourcePath=join(directory,"source.pdf"),root=join(directory,"scan");
    await writeFile(sourcePath,await source.save(),{mode:0o600});
    await execute("pdftoppm",["-jpeg","-gray","-r","180","-jpegopt",`quality=${quality}`,sourcePath,root],{timeout:45_000,maxBuffer:1_000_000});
    const scanned=await PDFDocument.create();for(let index=0;index<pageCount;index++){const image=await scanned.embedJpg(await readFile(`${root}-${index+1}.jpg`)),scannedPage=scanned.addPage([image.width,image.height]);scannedPage.drawImage(image,{x:0,y:0,width:image.width,height:image.height})}
    return Buffer.from(await scanned.save());
  }finally{await rm(directory,{recursive:true,force:true})}
}

async function main(){const started=Date.now(),before=process.resourceUsage(),scanned=await syntheticScan({pageCount:4,rotated:true}),result=await analyzeClientImportPdf(scanned),values=new Map(result.extracted.map(item=>[item.fieldPath,String(item.value)]));
  if(result.extractionStatus!=="OCR_COMPLETED")throw new Error(`Expected OCR_COMPLETED, received ${result.extractionStatus}: ${JSON.stringify({processed:result.diagnostics.processedPageCount,failed:result.diagnostics.failedPageCount,skipped:result.diagnostics.skippedPageCount,failure:result.diagnostics.failureCategory,durationMs:result.diagnostics.ocrDurationMs})}`);
  if(result.method!=="LOCAL_OCR")throw new Error(`Expected LOCAL_OCR, received ${result.method}`);
  if(result.diagnostics.processedPageCount!==4||result.diagnostics.failedPageCount||result.diagnostics.skippedPageCount)throw new Error(`Expected all four pages to complete: ${JSON.stringify({processed:result.diagnostics.processedPageCount,failed:result.diagnostics.failedPageCount,skipped:result.diagnostics.skippedPageCount,failure:result.diagnostics.failureCategory})}`);
  for(const[fieldPath,expected]of [["client.legalFirstName","Jane"],["client.legalLastName","Example"],["client.dateOfBirth","01/15/1990"],["client.addressLine1","123 Example Street"],["client.phone","555-0100"],["caseManager.name","Alex Sample"]])if(values.get(fieldPath)!==expected)throw new Error(`OCR mismatch for ${fieldPath}: ${values.get(fieldPath)??"missing"}; synthetic OCR text=${JSON.stringify(result.text)}`);
  if(!result.extracted.every(item=>item.sourceLocation.startsWith("Page 1 OCR text")))throw new Error("OCR proposal page provenance is missing");
  const highStarted=Date.now(),high=await analyzeClientImportPdf(await syntheticScan({width:1400,height:900,quality:45}));if(high.extractionStatus!=="OCR_COMPLETED"||high.diagnostics.processedPageCount!==1)throw new Error(`High-resolution/low-quality OCR failed: ${JSON.stringify({status:high.extractionStatus,failure:high.diagnostics.failureCategory})}`);
  const mixedPdf=await PDFDocument.create(),mixedFont=await mixedPdf.embedFont(StandardFonts.HelveticaBold),nativePage=mixedPdf.addPage([900,500]);nativePage.drawText("Legal first name: Native Legal last name: Reader",{x:45,y:400,size:24,font:mixedFont});const scannedSource=await PDFDocument.load(await syntheticScan()),[copied]=await mixedPdf.copyPages(scannedSource,[0]);mixedPdf.addPage(copied);const mixed=await analyzeClientImportPdf(Buffer.from(await mixedPdf.save())),nativeProposal=mixed.extracted.find(item=>item.fieldPath==="client.legalFirstName"&&item.value==="Native"&&item.method==="NATIVE_TEXT"),phoneProposal=mixed.extracted.find(item=>item.fieldPath==="client.phone"&&item.value==="555-0100"&&item.method==="LOCAL_OCR");if(mixed.extractionStatus!=="OCR_COMPLETED"||!mixed.diagnostics.nativeTextFound||mixed.diagnostics.processedPageCount!==1||!nativeProposal||!phoneProposal)throw new Error(`Mixed native/OCR verification failed: ${JSON.stringify({status:mixed.extractionStatus,native:mixed.diagnostics.nativeTextFound,processed:mixed.diagnostics.processedPageCount,nativeProposal:Boolean(nativeProposal),phoneProposal:Boolean(phoneProposal)})}`);
  const usage=process.resourceUsage(),measurement={multiPage:{pages:4,ocrDurationMs:result.diagnostics.ocrDurationMs},highResolutionLowQuality:{pages:1,durationMs:Date.now()-highStarted,ocrDurationMs:high.diagnostics.ocrDurationMs},mixedNativeOcr:{pages:2,ocrDurationMs:mixed.diagnostics.ocrDurationMs},totalDurationMs:Date.now()-started,maxRssKiB:usage.maxRSS,userCpuMicros:usage.userCPUTime-before.userCPUTime,systemCpuMicros:usage.systemCPUTime-before.systemCPUTime};
  console.log(`Document OCR runtime verified: multi-page, rotated, high-resolution, low-quality, and mixed native/OCR PDFs passed with bounded diagnostics. ${JSON.stringify(measurement)}`);
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Document OCR runtime verification failed");process.exitCode=1});
