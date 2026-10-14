import { expect, test, type Page } from "@playwright/test";

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
