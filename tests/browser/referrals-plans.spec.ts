import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { CSSP_BASIC, IAPP } from "@/domain/client-plans/templates";
import { REFERRAL_TEMPLATE } from "@/domain/referrals/templates";

async function enterVisualQa(page:Page){
  await page.goto("/dev/visual-qa");
  await page.getByRole("button",{name:"Enter visual QA as organization owner"}).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("authorized owner can use the referral dashboard without internal identity controls",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Referrals",exact:true}).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading",{name:"Referrals",exact:true})).toBeVisible();
  await expect(page.getByText("Development user ID")).toHaveCount(0);
  await page.getByRole("button",{name:/Create referral/}).click();
  await expect(page.getByRole("dialog",{name:"Create referral request"})).toBeVisible();
  await page.getByLabel("Recipient name").fill("Synthetic Browser Coordinator");
  await page.getByLabel("Recipient email").fill("browser-coordinator@example.test");
  await page.getByRole("button",{name:"Create draft",exact:true}).click();
  await expect(page.getByText("Referral draft created.")).toBeVisible();
  await expect(page.getByText("Synthetic Browser Coordinator").first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator("body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});

test("client document menu routes CSSP and IAPP through reviewed questionnaires",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button",{name:"Documents",exact:true}).click();
  await page.getByRole("button",{name:"Generate document",exact:true}).click();
  const menu=page.getByRole("dialog",{name:"Generate document"});
  await expect(menu.getByRole("link",{name:/CSSP/})).toBeVisible();
  await expect(menu.getByRole("link",{name:/IAPP/})).toBeVisible();
  await menu.getByRole("link",{name:/IAPP/}).click();
  await expect(page.getByRole("heading",{name:/Individual Abuse Prevention Plan/})).toBeVisible();
  await expect(page.getByText("A. Sexual abuse",{exact:true})).toBeVisible();
  await expect(page.getByText("E. History of violent crime or physical aggression toward others",{exact:true})).toBeVisible();
});

test("referral duplicate review supports bounded candidate selection and a non-overlapping mobile layout",async({page})=>{
  test.setTimeout(60_000);
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Referrals",exact:true}).click();
  await expect(page.getByText("Form completion",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("Referral disposition",{exact:true}).first()).toBeVisible();
  for(const viewport of [{width:390,height:844},{width:360,height:800}]){await page.setViewportSize(viewport);expect(await page.locator("body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);for(const card of await page.locator(".referral-card").all())expect((await card.boundingBox())?.width).toBeLessThanOrEqual(viewport.width)}
  await page.setViewportSize({width:1024,height:900});
  const pdf=await PDFDocument.create(),pdfPage=pdf.addPage([612,792]),form=pdf.getForm(),font=await pdf.embedFont(StandardFonts.Helvetica);for(const[name,value,y]of [["client_name","Sample Client One",700],["client_dob","1990-01-01",660]] as const){const field=form.createTextField(name);field.setText(value);field.addToPage(pdfPage,{x:40,y,width:240,height:20})}form.updateFieldAppearances(font);await page.getByLabel("Upload completed referral PDF").setInputFiles({name:"synthetic-browser-referral.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});await page.getByRole("button",{name:"Upload and extract"}).click();
  await expect(page.getByRole("dialog",{name:"Referral details"})).toBeVisible();
  await expect(page.getByText("Duplicate check not yet run",{exact:true})).toBeVisible();
  for(const path of ["client.fullName","client.dateOfBirth"]){await Promise.all([page.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/referrals/")&&response.status()===200),page.locator("article").filter({hasText:path}).getByRole("button",{name:"Accept"}).click()]);await page.waitForTimeout(100)}
  await expect(page.getByText("Possible matches found",{exact:true})).toBeVisible();
  await expect(page.getByText("Same name and date of birth",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Review and select"}).click();
  await expect(page.getByRole("region",{name:"Link existing client"})).toBeVisible();
  await expect(page.getByText("Select and confirm the correct existing client.",{exact:true})).toBeVisible();
  await expect(page.getByText("Confirm client linkage",{exact:true})).toBeVisible();
  await Promise.all([page.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/referrals/")&&response.status()===200),page.getByRole("button",{name:"Confirm linkage"}).click()]);
  await expect(page.getByText("Referral linked to the selected existing client. Canonical client information was not changed.")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Linked client"})).toBeVisible();
});

test("external referral, CSSP, and IAPP questionnaires expose accessible section progress without losing answers",async({page})=>{
  test.setTimeout(60_000);
  await page.route("**/api/public/referrals/**",async route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({template:REFERRAL_TEMPLATE,answers:{},status:"IN_PROGRESS",submittedAt:null,expiresAt:"2026-10-30T12:00:00.000Z"})}));
  await page.goto(`/refer/${"v".repeat(48)}`);
  await expect(page.getByRole("navigation",{name:"Questionnaire sections"})).toBeVisible();
  await expect(page.getByText(/required fields remaining/).first()).toBeVisible();
  const firstText=page.locator(".questionnaire-section input[type='text']").first();await firstText.fill("Preserved synthetic answer");
  await page.getByRole("button",{name:/Client information/i}).click();
  await expect(firstText).toHaveValue("Preserved synthetic answer");
  await page.getByRole("button",{name:"Submit referral"}).click();
  await expect(page.locator(".public-form-card>p[role='alert']")).toContainText("required field");
  await page.setViewportSize({width:390,height:844});expect(await page.locator("body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);

  await enterVisualQa(page);await page.getByRole("link",{name:"Clients",exact:true}).click();await page.locator(".client-directory-row").first().click();await page.getByRole("button",{name:"Documents",exact:true}).click();await page.getByRole("button",{name:"Generate document",exact:true}).click();const iappLink=page.getByRole("dialog",{name:"Generate document"}).getByRole("link",{name:/IAPP/}),href=await iappLink.getAttribute("href");expect(href).toBeTruthy();const clientId=new URL(href!,page.url()).pathname.split("/").at(-2)!;await iappLink.click();await verifyPlan(IAPP,"IAPP");
  await page.goto(`/admin/clients/${clientId}/plans?type=CSSP`);await expect(page.getByRole("heading",{name:"Administrator confirmation required"})).toBeVisible();await page.getByLabel("CSSP pathway").selectOption("BASIC");await page.getByLabel("Audited reason").fill("Synthetic browser confirmation only");await page.getByRole("button",{name:"Confirm pathway"}).click();await verifyPlan(CSSP_BASIC,"CSSP");

  async function verifyPlan(expected:typeof IAPP|typeof CSSP_BASIC,type:string){await expect(page.getByRole("heading",{name:expected.title})).toBeVisible();await expect(page.getByRole("navigation",{name:"Questionnaire sections"})).toBeVisible();await expect(page.getByText(/required fields remaining/).first()).toBeVisible();const input=page.locator(".questionnaire-section input[type='text']").first();if(await input.count()){await input.fill(`${type} preserved answer`);await page.getByRole("button",{name:new RegExp(expected.sections.at(-1)!.title)}).click();await expect(input).toHaveValue(`${type} preserved answer`)}expect(await page.locator("body").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true)}
});
