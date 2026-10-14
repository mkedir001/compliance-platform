import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type StructuredPdfField={label:string;value:string};
export type StructuredPdfSection={title:string;instructions?:string;fields:StructuredPdfField[]};

const WIDTH=612,HEIGHT=792,LEFT=42,RIGHT=42,TOP=748,BOTTOM=58;
const ink=rgb(.08,.2,.15),muted=rgb(.34,.38,.36),warning=rgb(.45,.18,.05);

function safe(value:string){return value.replaceAll(/[–—]/g,"-").replaceAll("·","-").replaceAll("’","'").replaceAll("“",'"').replaceAll("”",'"')}
function wrap(value:string,max:number){
 const paragraphs=safe(value).replaceAll("\r","").split("\n"),lines:string[]=[];
 for(const paragraph of paragraphs){let line="";for(const rawWord of paragraph.replace(/\s+/g," ").trim().split(" ").filter(Boolean)){const chunks=rawWord.match(new RegExp(`.{1,${max}}`,"g"))??[rawWord];for(const word of chunks){if(`${line} ${word}`.trim().length>max&&line){lines.push(line);line=word}else line=`${line} ${word}`.trim()}}lines.push(line||"-")}
 return lines.length?lines:["-"];
}

export async function renderStructuredPdf(input:{
 title:string;
 subtitleLines?:string[];
 sections:StructuredPdfSection[];
 closingSection?:{title:string;lines:string[];warning?:string};
 subject:string;
}){
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const pages:PDFPage[]=[],title=safe(input.title);let page!:PDFPage,y=TOP,activeSection:string|undefined;
 const drawLines=(lines:string[],x:number,font:PDFFont,size:number,color:RGB,lineHeight:number)=>{for(const line of lines){page.drawText(line,{x,y,size,font,color});y-=lineHeight}}
 const addPage=(continuation=false)=>{page=pdf.addPage([WIDTH,HEIGHT]);pages.push(page);y=TOP;if(continuation){page.drawText(`${title} - continued`,{x:LEFT,y,size:9,font:bold,color:ink});y-=17;if(activeSection){page.drawText(`${safe(activeSection)} (continued)`,{x:LEFT,y,size:10,font:bold,color:ink});y-=17}}};
 const ensure=(height:number)=>{if(y-height<BOTTOM)addPage(true)};
 addPage();
 drawLines(wrap(title,65),LEFT,bold,17,ink,20);y-=2;
 for(const subtitle of input.subtitleLines??[]){drawLines(wrap(subtitle,105),LEFT,regular,8,muted,10)}
 y-=13;
 for(const section of input.sections){
  const instructionLines=section.instructions?wrap(section.instructions,104):[],first=section.fields[0],firstValue=first?wrap(first.value,92):[];
  activeSection=section.title;ensure(24+instructionLines.length*10+(first?16+Math.min(firstValue.length,2)*11:0));
  drawLines(wrap(section.title,78),LEFT,bold,12,ink,15);y-=3;
  if(instructionLines.length){drawLines(instructionLines,LEFT,regular,8,muted,10);y-=4}
  for(const field of section.fields){
   const labelLines=wrap(field.label,100),valueLines=wrap(field.value,92),wholeHeight=labelLines.length*10+valueLines.length*11+8;
   if(wholeHeight<=TOP-BOTTOM-40)ensure(wholeHeight);
   else ensure(labelLines.length*10+24);
   drawLines(labelLines,LEFT,bold,8,ink,10);
   for(let index=0;index<valueLines.length;index++){
    if(y-11<BOTTOM){addPage(true);drawLines(wrap(`${field.label} (continued)`,100),LEFT,bold,8,ink,10)}
    page.drawText(valueLines[index],{x:LEFT+12,y,size:9,font:regular,color:ink});y-=11;
   }
   y-=7;
  }
 }
 if(input.closingSection){
  activeSection=input.closingSection.title;const closingLines=input.closingSection.lines.flatMap(line=>wrap(line,104));ensure(28+closingLines.length*11+(input.closingSection.warning?22:0));
  page.drawText(safe(input.closingSection.title),{x:LEFT,y,size:10,font:bold,color:ink});y-=15;drawLines(closingLines,LEFT,regular,8,ink,11);
  if(input.closingSection.warning){y-=2;drawLines(wrap(input.closingSection.warning,104),LEFT,regular,8,warning,10)}
 }
 for(const [index,current] of pages.entries()){
  current.drawLine({start:{x:LEFT,y:42},end:{x:WIDTH-RIGHT,y:42},thickness:.5,color:rgb(.78,.81,.79)});
  current.drawText(safe(input.title),{x:LEFT,y:27,size:7,font:regular,color:muted,maxWidth:420});
  current.drawText(`Page ${index+1} of ${pages.length}`,{x:WIDTH-RIGHT-62,y:27,size:7,font:regular,color:muted});
 }
 // pdf-lib 1.17 does not expose a reliable tagged-PDF structure-tree API. Set language and metadata, but do not claim PDF/UA; the corresponding HTML questionnaires retain semantic labels and navigation.
 pdf.catalog.set(PDFName.of("Lang"),PDFString.of("en-US"));pdf.setTitle(input.title);pdf.setSubject(input.subject);pdf.setCreator("Waldah Compliance Platform");pdf.setProducer("Waldah Compliance Platform");
 return Buffer.from(await pdf.save());
}
