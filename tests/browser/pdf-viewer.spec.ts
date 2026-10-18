import {expect,test,type Page} from "@playwright/test";

async function openImportedDocument(page:Page){
  await page.goto("/dev/visual-qa");
  await page.getByRole("button",{name:"Enter visual QA as organization owner"}).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button",{name:"Documents",exact:true}).click();
  await page.getByRole("option",{name:/Synthetic Rights Acknowledgment/}).click();
  await expect(page.getByText("synthetic-historical-rights.pdf")).toBeVisible();
}

test("authenticated imported PDF preview loads from validated same-origin bytes",async({page})=>{
  const responses:{contentType:string|null;contentLength:string|null}[]=[];
  page.on("response",response=>{if(response.url().includes("/documents?")&&response.url().includes("disposition=inline"))responses.push({contentType:response.headers()["content-type"]??null,contentLength:response.headers()["content-length"]??null})});
  await openImportedDocument(page);
  const frame=page.locator(".authoritative-document-preview iframe");
  await expect(frame).toHaveAttribute("src",/^blob:/);
  await expect(page.getByText("Preview blank or incomplete?")).toBeVisible();
  await expect(page.getByRole("link",{name:"Download original"})).toHaveAttribute("href",/artifact=final/);
  expect(responses).toContainEqual({contentType:"application/pdf",contentLength:expect.stringMatching(/^\d+$/)});
});

test("authenticated preview reports a sanitized recoverable failure",async({page})=>{
  await page.route(/\/api\/organizations\/.*\/clients\/.*\/documents\?.*disposition=inline/,route=>route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"synthetic private diagnostic"})}));
  await openImportedDocument(page);
  const alert=page.locator(".pdf-viewer-state[role=alert]");
  await expect(alert).toContainText("PDF preview unavailable");
  await expect(alert).not.toContainText("synthetic private diagnostic");
  await expect(page.getByRole("button",{name:"Retry preview"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Download original"})).toBeVisible();
});
