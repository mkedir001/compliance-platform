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

  const matching = page.getByRole("region", { name: "AxisCare client matching management" });
  await expect(matching).toBeVisible();
  await expect(matching.getByText("2 active", { exact: true })).toBeVisible();
  await expect(matching.getByText("3 inactive", { exact: true })).toBeVisible();
  await expect(matching.getByText("1 confirmed", { exact: true })).toBeVisible();
  await expect(matching.getByText("1 ignored", { exact: true })).toBeVisible();
  await expect(matching.getByText("Example Client Three", { exact: true })).toBeVisible();
  await expect(matching.getByText("Historical Inactive", { exact: true })).toHaveCount(0);
  await expect(matching.getByText("Synthetic Caregiver", { exact: true })).toHaveCount(0);

  await matching.getByLabel("AxisCare status").selectOption("INACTIVE");
  await expect(matching.getByText("Historical Inactive", { exact: true })).toBeVisible();
  await matching.getByLabel("AxisCare status").selectOption("UNKNOWN");
  await expect(matching.getByText("Status Unknown", { exact: true })).toBeVisible();
  await matching.getByLabel("AxisCare status").selectOption("ACTIVE");
  await matching.getByLabel("Select Example Client Three").check();
  await expect(matching.getByText("1 selected", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await matching.getByRole("button", { name: "Ignore selected" }).click();
  await expect(matching.getByText("1 client ignored.", { exact: true })).toBeVisible();
  await matching.getByLabel("Matching status").selectOption("IGNORED");
  await matching.getByLabel("AxisCare status").selectOption("ALL");
  await expect(matching.getByText("Example Client Three", { exact: true })).toBeVisible();
  await matching.getByRole("row").filter({ hasText: "Example Client Three" }).getByRole("button", { name: "Restore" }).click();
  await expect(matching.getByText("Restored to client matching. A match still requires confirmation.", { exact: true })).toBeVisible();

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
  await expect(matching).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/compliance-operations\?organizationId=/);
});
