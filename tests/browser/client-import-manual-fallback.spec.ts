import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

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
  await expect(page.getByText(/OCR required · Local OCR could not complete; manual review remains available/).first()).toBeVisible();
  await page.getByLabel(/Legal first name/).fill("Browser");
  await page.getByLabel(/Legal last name/).fill("Fallback");
  await page.getByRole("button",{name:"Save client details"}).click();
  await expect(page.getByText("Manual client details saved with reviewer provenance.")).toBeVisible();
  await page.getByRole("button",{name:"Confirm and create client"}).click();
  await page.waitForURL(/\/admin\/clients\/[^?]+\?/);
  await page.getByRole("button",{name:"Documents",exact:true}).click();
  await expect(page.getByText("synthetic-zero-field.pdf")).toBeVisible();
});
