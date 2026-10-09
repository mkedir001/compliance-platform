import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function enterVisualQa(page:Page){await page.goto("/dev/visual-qa");await page.getByRole("button",{name:"Enter visual QA as organization owner"}).click();await page.waitForURL(/\/admin\/compliance-operations/)}
async function syntheticPdf(label:string){const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText(`Admission Form Legal first name: Synthetic Last name: ${label}`,{x:40,y:730,font,size:12});return Buffer.from(await pdf.save())}
async function beginImport(page:Page,files:Array<{name:string;mimeType:string;buffer:Buffer}>){await page.getByRole("button",{name:/Add client/}).click();await page.getByRole("radio",{name:/Upload documents/}).click();await page.locator('input[type="file"]').setInputFiles(files);await page.getByRole("button",{name:"Upload and review"}).click();await expect(page.getByRole("heading",{name:"Review imported documents"})).toBeVisible()}

test("discard clears an eight-document review, blocks stale resume, and allows a fresh import",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  const stamp=Date.now(),files=await Promise.all(Array.from({length:8},async(_,index)=>({name:`discard-${stamp}-${index+1}.pdf`,mimeType:"application/pdf",buffer:await syntheticPdf(`Packet${index+1}`)})));
  await beginImport(page,files);
  const staleReviewUrl=page.url();
  await page.getByLabel(/Legal first name/).fill("Saved");
  await page.getByLabel(/Legal last name/).fill("Progress");
  await page.getByRole("button",{name:"Save client details"}).click();
  await expect(page.getByText("Manual client details saved with reviewer provenance.")).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Discard import"}).click();
  await page.waitForURL(url=>url.pathname==="/admin/clients"&&!url.searchParams.has("importSessionId"));
  await expect(page.getByRole("heading",{name:"Clients",exact:true})).toBeVisible();
  await expect(page.getByText(files[0].name)).toHaveCount(0);

  await page.goto(staleReviewUrl);
  await expect(page.getByText("This import is closed or no longer available. Return to Clients to start a new import.")).toBeVisible();
  await expect(page.getByText(files[0].name)).toHaveCount(0);
  await page.getByRole("button",{name:"Back to Clients"}).click();
  await page.waitForURL(url=>url.pathname==="/admin/clients"&&!url.searchParams.has("importSessionId"));

  const fresh={name:`fresh-${stamp}.pdf`,mimeType:"application/pdf",buffer:await syntheticPdf("Fresh")};
  await beginImport(page,[fresh]);
  await expect(page.getByText(fresh.name)).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Discard import"}).click();
  await page.waitForURL(url=>url.pathname==="/admin/clients"&&!url.searchParams.has("importSessionId"));
});
