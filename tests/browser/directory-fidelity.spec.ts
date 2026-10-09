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
  const clientRow = page.locator(".client-directory-row").first();
  await expect(clientRow).toBeVisible();
  expect(await clientRow.locator("strong").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  expect((await page.getByPlaceholder("Search by name or MA/PMI").boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/compliance-clients-918-reference-viewport.png", clip: { x: 248, y: 58, width: 918, height: 742 } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/compliance-clients-large-desktop.png", fullPage: true });
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
  const employeeRowAction = page.locator(".employee-directory-row").first();
  await expect(employeeRowAction).toBeVisible();
  expect(await page.locator(".employee-directory-row strong").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  expect((await page.getByPlaceholder("Search by name or employee number").boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/compliance-employees-918-reference-viewport.png", clip: { x: 248, y: 58, width: 918, height: 742 } });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.getByPlaceholder("Search by name or employee number")).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("employee rows support pointer and keyboard navigation without hijacking invitation actions", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 800 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Employees", exact: true }).click();

  const firstRowAction = page.locator(".employee-directory-row").first();
  await firstRowAction.focus();
  await expect(firstRowAction).toBeFocused();
  await firstRowAction.press("Enter");
  await expect(page.getByText("Employee record", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Employees", exact: true }).click();
  const keyboardRowAction = page.locator(".employee-directory-row").nth(1);
  await keyboardRowAction.focus();
  await keyboardRowAction.press("Space");
  await expect(page.getByText("Employee record", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Employees", exact: true }).click();
  await page.route("**/portal-access", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invitation: { deliveryStatus: "PENDING" } }) });
      return;
    }
    await route.continue();
  });
  const directoryUrl = page.url();
  await page.getByRole("button", { name: "Reissue invitation", exact: true }).first().click();
  await expect(page).toHaveURL(directoryUrl);
  await expect(page.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
});

test("document actions use readable controls and accessible dropdowns", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 900 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button", { name: "Documents", exact: true }).click();

  const generate = page.getByRole("button", { name: "Generate document", exact: true });
  const request = page.getByRole("button", { name: "Request document", exact: true });
  for (const action of [generate, request]) {
    expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(42);
    expect(await action.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  }
  await generate.click();
  await expect(page.getByRole("dialog", { name: "Generate document" })).toBeVisible();
  await page.keyboard.press("Escape");
  await request.click();
  await expect(page.getByRole("dialog", { name: "Request document" })).toBeVisible();
  await page.screenshot({ path: "/tmp/compliance-client-documents-actions.png", fullPage: true });

  for (const viewport of [{ width: 1024, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(generate).toBeVisible();
    await expect(request).toBeVisible();
  }
});
