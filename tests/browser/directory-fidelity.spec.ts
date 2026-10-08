import { expect, test, type Page } from "@playwright/test";

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("approved client directory structure remains functional and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 800 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search by name or MA/PMI")).toBeVisible();
  await expect(page.getByRole("table", { name: "Client directory" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add client/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/compliance-clients-918-reference-viewport.png", clip: { x: 248, y: 58, width: 918, height: 742 } });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.getByPlaceholder("Search by name or MA/PMI")).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("approved employee directory structure keeps filtering and actions accessible", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 800 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Employees", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search by name or employee number")).toBeVisible();
  await expect(page.getByText("Employment, portal access, and compliance are tracked separately for each person.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Import from CSV/ })).toBeVisible();
  await expect(page.getByText(/Showing \d+ of \d+ employees/)).toBeVisible();
  await page.screenshot({ path: "/tmp/compliance-employees-918-reference-viewport.png", clip: { x: 248, y: 58, width: 918, height: 742 } });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.getByPlaceholder("Search by name or employee number")).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
