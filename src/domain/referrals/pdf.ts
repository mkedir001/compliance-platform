import { REFERRAL_TEMPLATE } from "./templates";
import { renderStructuredPdf } from "@/domain/pdf/structured-document";

type Answers=Record<string,unknown>;
function display(value:unknown){return Array.isArray(value)?value.join(", "):typeof value==="string"?value:typeof value==="boolean"?(value?"Yes":"No"):""}
export async function renderReferralPdf(answers:Answers, metadata:{submittedAt:Date;submissionId:string}){
 return renderStructuredPdf({title:REFERRAL_TEMPLATE.title,subject:"Immutable referral submission evidence",subtitleLines:[`Template ${REFERRAL_TEMPLATE.code} v${REFERRAL_TEMPLATE.version} - submitted ${metadata.submittedAt.toISOString()}`],sections:REFERRAL_TEMPLATE.sections.map(section=>({title:section.title,fields:section.fields.map(field=>{const selected=Array.isArray(answers[field.key])?answers[field.key] as unknown[]:[],value=field.type==="checkboxes"?field.options?.map(option=>`${selected.includes(option)?"[x]":"[ ]"} ${option}`).join("\n")??"":display(answers[field.key]);return{label:field.label,value}})})),closingSection:{title:"Submission evidence",lines:[`Immutable submission reference: ${metadata.submissionId}`],warning:"Requested services shown in this referral are not service authorizations."}});
}
