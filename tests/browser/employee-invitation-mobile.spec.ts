import { expect, test } from "@playwright/test";

const token = "visual-qa-pending-invitation-token-2026";

test("mobile employee invitation is server-resolved and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/learn/claim/${token}`);
  await expect(page.getByRole("heading", { name: "Waldah access" })).toBeVisible();
  await expect(page.getByText("Your invitation is ready.", { exact: false })).toBeVisible();
  await expect(page.getByText("Checking your invitation", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue securely" })).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.reload();
  await expect(page.getByText("Your invitation is ready.", { exact: false })).toBeVisible();
  await page.goto(`/learn/claim/${"x".repeat(43)}`);
  await expect(page.getByRole("alert")).toContainText("invalid or unavailable");
});
