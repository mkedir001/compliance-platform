import { expect, test, type Page } from "@playwright/test";

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("authenticated medication reviewer can inspect the client MAR without implicit administration authority", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 850 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button", { name: "Medication", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Medication", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "MAR", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Medications", exact: true })).toBeVisible();
  await expect(page.getByText(/Administration documentation is unavailable until/)).toBeVisible();
  await expect(page.getByText(/Click any day, past or present/)).toHaveCount(0);

  await page.getByRole("button", { name: "Medications", exact: true }).click();
  await expect(page.getByRole("button", { name: /Add medication/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Medication", exact: true })).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
