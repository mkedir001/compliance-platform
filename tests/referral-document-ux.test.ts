import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { referralFormLabel, referralHistoryLabel } from "@/app/admin/referrals/referrals-portal";
import { renderPlanPdf } from "@/domain/client-plans/service";
import { IAPP } from "@/domain/client-plans/templates";
import { renderReferralPdf } from "@/domain/referrals/pdf";
import { REFERRAL_TEMPLATE } from "@/domain/referrals/templates";

async function pages(bytes:Buffer){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true}),document=await task.promise,result:string[]=[];for(let number=1;number<=document.numPages;number++){const content=await(await document.getPage(number)).getTextContent();result.push(content.items.map(item=>"str" in item?item.str:"").join(" "))}await task.destroy();return result}

describe("referral and plan UX remediation",()=>{
 it("uses human-readable history and separate form completion language",()=>{
  expect(referralFormLabel("SUBMITTED")).toBe("Completed");
  expect(referralHistoryLabel("referral.created")).toBe("Referral created");
  expect(referralHistoryLabel("referral.draft_saved")).toBe("Draft saved");
  expect(referralHistoryLabel("referral.client_linked")).toBe("Referral linked to client");
 });

 it("keeps responsive cards and accessible reusable questionnaire navigation in the rendered sources",()=>{
  const css=readFileSync("src/app/globals.css","utf8"),navigation=readFileSync("src/app/components/questionnaire-navigation.tsx","utf8"),portal=readFileSync("src/app/admin/referrals/referrals-portal.tsx","utf8");
  expect(css).toContain("@media(max-width:600px){.referral-card{grid-template-columns:1fr");
  expect(css).toContain("max-width:100vw;overflow-x:hidden");
  expect(navigation).toContain('aria-label="Questionnaire sections"');
  expect(navigation).toContain('aria-current={section.id===currentId?"step"');
  expect(navigation).toContain("Previous section");
  expect(navigation).toContain("Next section");
  expect(portal).toContain("Form completion");
  expect(portal).toContain("Referral disposition");
  expect(portal).not.toContain("window.prompt");
 });

 it("paginates long referral evidence with continuation headers, page numbers, and preserved answers",async()=>{
  const answers=Object.fromEntries(REFERRAL_TEMPLATE.sections.flatMap(section=>section.fields.map((field,index)=>[field.key,field.type==="checkboxes"?field.options:`Preserved referral answer ${index} `.repeat(28)])));
  const rendered=await renderReferralPdf(answers,{submittedAt:new Date("2026-10-14T12:00:00Z"),submissionId:"synthetic-submission-reference"}),text=await pages(rendered),joined=text.join(" ");
  expect(text.length).toBeGreaterThan(2);
  text.forEach((page,index)=>expect(page).toContain(`Page ${index+1} of ${text.length}`));
  expect(joined).toContain("continued");
  expect(joined).toContain("synthetic-submission-reference");
  expect(joined).toContain("Requested services shown in this referral are not service authorizations");
  expect(joined).toContain("[x]");
 });

 it("paginates long IAPP content without losing required sections or the stable signature block",async()=>{
  const answers=Object.fromEntries(IAPP.sections.flatMap(section=>section.fields.map((field,index)=>[field.key,`Preserved IAPP answer ${index} `.repeat(35)]))),rendered=await renderPlanPdf(IAPP.title,"Synthetic Person",IAPP.sections,answers,{templateCode:IAPP.code,version:IAPP.version,pathway:"IAPP",questionnaireId:"synthetic-questionnaire-reference"}),text=await pages(rendered),joined=text.join(" ");
  expect(text.length).toBeGreaterThan(3);
  text.forEach((page,index)=>expect(page).toContain(`Page ${index+1} of ${text.length}`));
  for(const section of IAPP.sections)expect(joined).toContain(section.title.replaceAll("—","-"));
  expect(joined).toContain("Signatures and document reference");
  expect(joined).toContain("synthetic-questionnaire-reference");
 });
});
