import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

test("authorized reviewer source-verifies and batch-signs AxisCare-backed history in the existing MAR", async ({ page }) => {
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
  await expect(page.getByText("Historical MAR reconstruction and source verification")).toBeVisible();
  await expect(page.getByText(/Scheduled records and attendance evidence never prove administration/)).toBeVisible();
  const workbook = new ExcelJS.Workbook(), shifts = workbook.addWorksheet("Shifts"); workbook.addWorksheet("Summary");
  shifts.addRow(["Date of service", "Weekday", "Employee", "Employee #", "Service line", "Clock in", "Clock out", "Hours", "Source", "Visit status", "Manual EVV entry"]);
  const local = (hour: number) => new Date(Date.UTC(2026, 9, 16, hour));
  shifts.addRow([local(0), "Friday", "Synthetic Caregiver", "SYN-BROWSER", "SERVICE", local(7), local(15), 8, "EVV (app/phone)", "Processed", "No"]);
  const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  const supplement = page.getByLabel("Verified Pavilio attendance import");
  await expect(supplement.getByText("Supplement incomplete AxisCare attendance")).toBeVisible();
  await supplement.getByLabel("Pavilio XLSX workbook").setInputFiles({ name: "synthetic-attendance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbookBytes });
  await supplement.getByRole("checkbox", { name: /I confirm this workbook belongs/ }).check();
  await supplement.getByRole("button", { name: "Inspect workbook (no changes)" }).click();
  await expect(supplement.getByText(/1 usable of 1 attendance rows/)).toBeVisible();
  await supplement.getByLabel(/Synthetic Caregiver · source ID SYN-BROWSER/).selectOption({ index: 2 });
  await supplement.getByRole("button", { name: "Preview reconciled MAR staging" }).click();
  await expect(supplement.getByText(/scheduled occurrences/)).toBeVisible();
  const filters = page.getByLabel("Historical MAR review filters");
  await expect(filters.getByLabel("Medication")).toBeVisible();
  await filters.getByLabel("Medication").selectOption({ label: "Synthetic historical medication" });
  await expect(filters.getByLabel("Import batch")).toBeVisible();
  const card = page.locator(".med-history-card").filter({ hasText: "Synthetic historical medication" });
  await expect(card.getByText(/actual clock coverage/)).toBeVisible();
  await card.getByLabel("Authoritative source reference").fill("Synthetic paper MAR held in organization custody");
  await card.getByRole("button", { name: "Mark source-verified" }).click();
  await card.getByRole("checkbox", { name: /Include this source-verified entry/ }).check();
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
  await card.getByLabel("Source-record outcome").selectOption("HELD");
  await card.getByLabel("Transcription note").fill("Held per synthetic paper MAR");
  await card.getByLabel("Correction reason").fill("Synthetic browser verification correction request");
  await card.getByRole("button", { name: "Source-verify correction" }).click();
  await expect(card.getByText("source verified", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Historical MAR reconstruction and source verification")).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
