import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function enterVisualQa(page:Page){await page.goto("/dev/visual-qa");await page.getByRole("button",{name:"Enter visual QA as organization owner"}).click();await page.waitForURL(/\/admin\/compliance-operations/)}

test("unknown zero-field PDF remains retainable through manual client creation",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.getByRole("button",{name:/Add client/}).click();
  await page.getByRole("radio",{name:/Upload documents/}).click();
  const pdf=await PDFDocument.create();pdf.addPage([612,792]);
  await page.locator('input[type="file"]').setInputFiles({name:"synthetic-zero-field.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
  await page.getByRole("button",{name:"Upload and review"}).click();
  await expect(page.getByRole("heading",{name:"Review imported documents"})).toBeVisible();
  await expect(page.getByText(/OCR failed · OCR engine unavailable · Manual review available/).first()).toBeVisible();
  await page.getByLabel(/Legal first name/).fill("Browser");
  await page.getByLabel(/Legal last name/).fill("Fallback");
  await page.getByRole("button",{name:"Save client details"}).click();
  await expect(page.getByText("Manual client details saved with reviewer provenance.")).toBeVisible();
  await page.getByRole("button",{name:"Confirm and create client"}).click();
  await page.waitForURL(/\/admin\/clients\/[^?]+\?/);
  await page.getByRole("button",{name:"Documents",exact:true}).click();
  await expect(page.getByText("synthetic-zero-field.pdf")).toBeVisible();
});

test("existing-client document review uses authoritative identity and exposes safe extracted text",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button",{name:"Import documents",exact:true}).click();
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),pdfPage=pdf.addPage();pdfPage.drawText("Synthetic readable correspondence without supported client labels",{x:40,y:700,font,size:12});
  const region=page.getByRole("region",{name:"Import documents for this client"});
  await region.locator('input[type="file"]').setInputFiles({name:"synthetic-existing-document.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
  await region.getByRole("button",{name:"Upload and analyze"}).click();
  await expect(page.getByRole("heading",{name:"Review imported documents"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Existing client destination"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Manual client details"})).toHaveCount(0);
  await expect(page.getByText(/OCR failed · OCR engine unavailable · Manual review available/).first()).toBeVisible();
  await page.route("**/*view=extracted-text",route=>route.fulfill({status:200,contentType:"application/json",headers:{"cache-control":"no-store"},body:JSON.stringify({pageCount:1,extractionStatus:"TEXT_EXTRACTED",methods:["NATIVE_TEXT"],partial:false,pageBoundariesPreserved:true,pages:[{pageNumber:1,method:"NATIVE_TEXT",text:"Synthetic readable correspondence <script>window.previewExecuted=true</script>"}],processingDiagnostics:null})}));
  await page.getByRole("button",{name:"View extracted text"}).click();
  const preview=page.getByRole("region",{name:"Machine-extracted text"});
  await expect(preview).toContainText("Synthetic readable correspondence");
  await expect(preview).toContainText("<script>window.previewExecuted=true</script>");
  expect(await page.evaluate(()=>"previewExecuted" in window)).toBe(false);
  await expect(preview).toContainText("unverified and does not update the client record");
});

test("fresh import displays exact proposed values and current extraction diagnostics",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.getByRole("button",{name:/Add client/}).click();
  await page.getByRole("radio",{name:/Upload documents/}).click();
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),pdfPage=pdf.addPage([612,792]),form=pdf.getForm(),fields={legal_first_name:"Jane",legal_last_name:"Example",date_of_birth:"01/15/1990",address:"123 Example Street",phone:"555-0100",case_manager_name:"Alex Sample"};let y=700;for(const[name,value]of Object.entries(fields)){const field=form.createTextField(name);field.setText(value);field.addToPage(pdfPage,{x:40,y,width:220,height:20});y-=35}form.updateFieldAppearances(font);
  await page.locator('input[type="file"]').setInputFiles({name:"synthetic-exact-values.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
  await page.getByRole("button",{name:"Upload and review"}).click();
  await expect(page.getByRole("heading",{name:"Review imported documents"})).toBeVisible();
  await expect(page.getByText(/Pipeline v2 · attempt [a-f0-9]{8} · readable content yes · 6 proposals · Complete/)).toBeVisible();
  for(const value of ["Jane","Example","01/15/1990","123 Example Street","Alex Sample"])await expect(page.getByText(value,{exact:true}).first()).toBeVisible();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await expect(page.getByText("555-0100",{exact:true}).first()).toBeVisible();
});

test("HTML gateway failure produces an actionable ambiguous-outcome message and preserves selection",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button",{name:"Import documents",exact:true}).click();
  const pdf=await PDFDocument.create();pdf.addPage([612,792]);
  const region=page.getByRole("region",{name:"Import documents for this client"}),input=region.locator('input[type="file"]');
  await input.setInputFiles({name:"synthetic-ambiguous.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
  await page.route("**/api/organizations/*/clients/imports**",async route=>{const request=route.request(),url=new URL(request.url());if(request.method()==="POST")return route.fulfill({status:504,contentType:"text/html",body:"<html><h1>Gateway Time-out</h1></html>"});if(url.searchParams.has("requestId"))return route.fulfill({status:404,contentType:"application/json",body:JSON.stringify({error:"Upload operation not found"})});return route.continue()});
  await region.getByRole("button",{name:"Upload and analyze"}).click();
  await expect(region.getByText(/server outcome could not be confirmed/i)).toBeVisible();
  await expect(region.getByText(/Unexpected token|<html>/)).toHaveCount(0);
  expect(await input.evaluate((node:HTMLInputElement)=>node.files?.length)).toBe(1);
});
