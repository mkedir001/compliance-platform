import { expect, test } from "@playwright/test";

test("recipient name accepts continuous typing without remount or focus loss",async({page})=>{
  await page.goto("/dev/signature-recipient-focus");
  const name=page.getByTestId("signature-recipient-name");
  await name.click();
  await name.pressSequentially("Synthetic Recipient Full Name",{delay:15});
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Synthetic Recipient Full Name");
  await expect(page.getByTestId("recipient-value")).toHaveText("Synthetic Recipient Full Name");
  const email=page.getByTestId("signature-recipient-email");
  await email.fill("recipient@example.test");
  await expect(email).toHaveValue("recipient@example.test");
});
