import { expect, test, type Page } from "@playwright/test";

async function enterVisualQa(page:Page){await page.goto("/dev/visual-qa");await page.getByRole("button",{name:"Enter visual QA as organization owner"}).click();await page.waitForURL(/\/admin\/compliance-operations/)}

test("care profile projects canonical client information in the authorized client workspace",async({page})=>{
  await enterVisualQa(page);
  await page.getByRole("link",{name:"Clients",exact:true}).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button",{name:"Care profile",exact:true}).click();
  const profile=page.getByRole("region",{name:"Care profile"});
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Client and communication"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Person-centered information"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Authorized services"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Representatives and support contacts"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Emergency contacts"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Health information"})).toBeVisible();
  await expect(profile.getByRole("heading",{name:"Reviewed care and safety answers"})).toBeVisible();
  await expect(profile).toContainText("Document answers retain their source and never replace canonical client information automatically.");
});
