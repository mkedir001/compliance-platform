import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { analyzeClientImportPdf } from "../src/domain/clients/imports";

const execute=promisify(execFile);

async function syntheticScan(){
  const directory=await mkdtemp(join(tmpdir(),"ocr-runtime-check-"));
  try{
    const source=await PDFDocument.create(),page=source.addPage([900,500]),font=await source.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Admission Form",{x:45,y:420,size:26,font});
    page.drawText("Legal first name: Synthetic",{x:45,y:340,size:22,font});
    page.drawText("Last name: Scanner",{x:45,y:285,size:22,font});
    page.drawText("Date of birth: 04/03/1990",{x:45,y:230,size:22,font});
    page.drawText("Phone: 555-0104",{x:45,y:175,size:22,font});
    const sourcePath=join(directory,"source.pdf"),root=join(directory,"scan");
    await writeFile(sourcePath,await source.save(),{mode:0o600});
    await execute("pdftoppm",["-f","1","-l","1","-singlefile","-png","-r","200",sourcePath,root],{timeout:15_000,maxBuffer:1_000_000});
    const scanned=await PDFDocument.create(),image=await scanned.embedPng(await readFile(`${root}.png`)),scannedPage=scanned.addPage([image.width,image.height]);
    scannedPage.drawImage(image,{x:0,y:0,width:image.width,height:image.height});
    return Buffer.from(await scanned.save());
  }finally{await rm(directory,{recursive:true,force:true})}
}

async function main(){const scanned=await syntheticScan(),result=await analyzeClientImportPdf(scanned),values=new Map(result.extracted.map(item=>[item.fieldPath,String(item.value)]));
  if(result.extractionStatus!=="OCR_COMPLETED")throw new Error(`Expected OCR_COMPLETED, received ${result.extractionStatus}`);
  if(result.method!=="LOCAL_OCR")throw new Error(`Expected LOCAL_OCR, received ${result.method}`);
  for(const[fieldPath,expected]of [["client.legalFirstName","Synthetic"],["client.legalLastName","Scanner"],["client.dateOfBirth","04/03/1990"],["client.phone","555-0104"]])if(values.get(fieldPath)!==expected)throw new Error(`OCR mismatch for ${fieldPath}: ${values.get(fieldPath)??"missing"}`);
  if(!result.extracted.every(item=>item.sourceLocation.startsWith("Page 1 OCR text")))throw new Error("OCR proposal page provenance is missing");
  console.log("Document OCR runtime verified: scanned PDF text, mapped values, method, and page provenance passed.");
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Document OCR runtime verification failed");process.exitCode=1});
