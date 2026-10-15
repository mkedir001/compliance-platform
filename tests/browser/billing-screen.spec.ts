import { expect, test } from "@playwright/test";

test("authorized owner opens the safe responsive billing screen from the existing sidebar", async ({ page }) => {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await page.waitForURL(/\/admin\/billing\?organizationId=/);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByText("AxisCare visit synchronization is not connected.")).toBeVisible();
  await page.getByText("AxisCare integration settings", { exact: true }).click();
  await expect(page.locator(".billing-integration-admin").getByText("Not configured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AxisCare site URL")).toHaveValue("https://10461.axiscare.com");
  await expect(page.getByLabel("API bearer token")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Synchronize now" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Billing actions unavailable" })).toBeDisabled();
  await expect(page.getByText("Preview with sample data")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Confirm billing|Bill now/ })).toHaveCount(0);

  const cards = page.locator(".billing-card-open");
  if (await cards.count()) {
    await cards.first().click();
    await expect(page.getByText("Billing actions are disabled.")).toBeVisible();
    await page.getByRole("button", { name: "← All clients" }).click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/compliance-operations\?organizationId=/);
});
