import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { REFERRAL_TEMPLATE } from "./templates";

type Answers=Record<string,unknown>;
function display(value:unknown){return Array.isArray(value)?value.join(", "):typeof value==="string"?value:typeof value==="boolean"?(value?"Yes":"No"):""}
function wrap(value:string,max=88){const lines:string[]=[];let line="";for(const word of value.replace(/\s+/g," ").trim().split(" ")){if((line+" "+word).trim().length>max&&line){lines.push(line);line=word}else line=(line+" "+word).trim()}if(line)lines.push(line);return lines.length?lines:["—"]}
export async function renderReferralPdf(answers:Answers, metadata:{submittedAt:Date;submissionId:string}){
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);let page=pdf.addPage([612,792]),y=748;
 const next=(needed=30)=>{if(y-needed<54){page=pdf.addPage([612,792]);y=748}}
 page.drawText(REFERRAL_TEMPLATE.title,{x:42,y,size:18,font:bold,color:rgb(.08,.2,.15)});y-=24;page.drawText(`Template ${REFERRAL_TEMPLATE.code} v${REFERRAL_TEMPLATE.version} · submitted ${metadata.submittedAt.toISOString()}`,{x:42,y,size:8,font:regular});y-=24;
 for(const section of REFERRAL_TEMPLATE.sections){next(50);page.drawText(section.title,{x:42,y,size:12,font:bold,color:rgb(.08,.2,.15)});y-=18;for(const field of section.fields){const selected=Array.isArray(answers[field.key])?answers[field.key] as unknown[]:[],rendered=field.type==="checkboxes"?field.options?.map(option=>`${selected.includes(option)?"[x]":"[ ]"} ${option}`).join("   ")??"":display(answers[field.key]),lines=wrap(rendered);next(18+lines.length*11);page.drawText(field.label,{x:42,y,size:8,font:bold});y-=11;for(const line of lines){page.drawText(line,{x:54,y,size:9,font:regular});y-=11}y-=5}}
 next(45);page.drawText("Submission evidence",{x:42,y,size:10,font:bold});y-=14;page.drawText(`Immutable submission reference: ${metadata.submissionId}`,{x:42,y,size:8,font:regular});y-=11;page.drawText("Requested services shown in this referral are not service authorizations.",{x:42,y,size:8,font:regular,color:rgb(.45,.18,.05)});
 pdf.setTitle("Completed referral form");pdf.setSubject("Immutable referral submission evidence");return Buffer.from(await pdf.save());
}
