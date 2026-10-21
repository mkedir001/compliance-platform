import { expect, test, type Page } from "@playwright/test";

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("authenticated owner manages organization invitations and the WC icon is served", async ({ page, request }) => {
  await enterVisualQa(page);
  const icon = await request.get("/icon.svg");
  expect(icon.ok()).toBe(true);
  expect(await icon.text()).toContain("<svg");

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Users & Permissions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users & Permissions" })).toBeVisible();
  await expect(page.getByText("visual.qa.owner@example.test", { exact: true }).first()).toBeVisible();

  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Invite user" }).click();
  await expect(page.getByRole("dialog", { name: "Invite organization user" })).toBeVisible();
  await page.getByLabel("Display name").fill("Synthetic Billing Viewer");
  const email = `visual-qa-billing-${Date.now()}@example.test`;
  await page.getByLabel("Email").fill(email);
  await page.locator('select[name="roleDefinitionId"]').selectOption({ label: "Billing Viewer" });
  await page.getByRole("button", { name: "Review and send invitation" }).click();
  await expect(page.getByText("Invitation created and delivery attempted securely.")).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  const card = page.getByText(email, { exact: false }).locator("xpath=ancestor::article");
  await card.getByRole("button", { name: "Reissue" }).click();
  await expect(page.getByText("Invitation safely reissued.")).toBeVisible();
  const currentCard = page.getByText(email, { exact: false }).locator("xpath=ancestor::article");
  await currentCard.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Invitation cancelled.")).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toHaveCount(0);
});
