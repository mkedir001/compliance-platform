import { expect, test } from "@playwright/test";

test("authorized owner opens the safe responsive billing screen from the existing sidebar", async ({ page }) => {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await page.waitForURL(/\/admin\/billing\?organizationId=/);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.locator(".billing-integration-admin").getByText("Not configured", { exact: true })).toBeVisible();
  await page.getByText("AxisCare integration", { exact: true }).click();
  await expect(page.locator(".billing-integration-admin").getByText("Not configured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AxisCare site URL")).toHaveValue("https://10461.axiscare.com");
  await expect(page.getByLabel("API bearer token")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Synchronize now" })).toBeDisabled();
  await expect(page.getByText("Preview with sample data")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Confirm billing/ })).toHaveCount(0);

  const directBillingUrl = page.url();
  await page.goto(directBillingUrl);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.locator(".billing-integration-admin").getByText("Not configured", { exact: true })).toBeVisible();

  const rows = page.locator(".billing-directory-row");
  if (await rows.count()) {
    await rows.first().getByRole("link", { name: /More details/ }).click();
    await page.waitForURL(/\/admin\/billing\/[^/?]+\?organizationId=/);
    await expect(page.getByRole("link", { name: "← All clients" })).toBeVisible();
    await page.getByRole("link", { name: "← All clients" }).click();
    await page.waitForURL(/\/admin\/billing\?organizationId=/);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/compliance-operations\?organizationId=/);
});
