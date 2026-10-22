import { expect, test, type Page } from "@playwright/test";

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("synthetic caregiver reviews and batch-signs AxisCare-backed history in the existing MAR", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await enterVisualQa(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: /Client One, Sam/ }).click();
  await page.getByRole("button", { name: "Medication", exact: true }).click();

  const signature = page.getByText("Set up your signature (one time)");
  await expect(signature).toBeVisible();
  await page.getByLabel("Type your full legal name").fill("Avery Stone");
  await page.getByRole("checkbox", { name: /I adopt this typed name/ }).check();
  await page.getByRole("button", { name: "Adopt signature" }).click();

  await page.getByRole("button", { name: "Historical review" }).click();
  await expect(page.getByText("Historical paper MAR verification")).toBeVisible();
  await expect(page.getByText(/AxisCare clock evidence proposes caregiver attribution only/)).toBeVisible();
  const filters = page.getByLabel("Historical MAR review filters");
  await expect(filters.getByLabel("Medication")).toBeVisible();
  await filters.getByLabel("Medication").selectOption({ label: "Synthetic historical medication" });
  await expect(filters.getByLabel("Import batch")).toBeVisible();
  const card = page.locator(".med-history-card").filter({ hasText: "Synthetic historical medication" });
  await expect(card.getByText(/actual clock coverage/)).toBeVisible();
  await card.getByRole("button", { name: "Mark reviewed" }).click();
  await card.getByRole("checkbox", { name: /Include this reviewed entry/ }).check();
  await page.getByRole("button", { name: "Sign 1 reviewed entry" }).click();
  await expect(card.getByText("attested", { exact: true })).toBeVisible();
  await expect(card.getByText(/Electronically verified later/)).toBeVisible();

  await page.getByRole("button", { name: "MAR", exact: true }).click();
  await expect(page.getByText("Historical paper MAR, electronically verified later")).toBeVisible();
  await expect(page.getByRole("button", { name: /historical paper MAR verified electronically later/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print / PDF" })).toBeVisible();
  await page.getByText(/Administrator only · counts and entry history/).click();
  await expect(page.getByText(/historical_attested/)).toBeVisible();
  await page.getByRole("button", { name: "Historical review" }).click();
  await card.getByLabel("Discrepancy / correction request").fill("Paper MAR requires administrator correction review");
  await card.getByLabel("Correction reason").fill("Synthetic browser verification correction request");
  await card.getByRole("button", { name: "Flag for correction" }).click();
  await expect(card.getByText("flagged for correction", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Historical paper MAR verification")).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
