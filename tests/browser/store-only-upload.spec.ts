import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function openUploadModes(page: import("@playwright/test").Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button", { name: "Import documents", exact: true }).click();
  return page.getByRole("region", { name: "Import documents for this client" });
}

test("upload modes remain synchronized, keyboard accessible, and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const region = await openUploadModes(page);
  const store = region.getByRole("radio", { name: /Store only/ });
  const care = region.getByRole("radio", { name: /Review for the care profile only/ });
  const full = region.getByRole("radio", { name: /Review for the full client record/ });

  await expect(full).toBeChecked();
  await region.getByText("Review for the care profile only", { exact: true }).click();
  await expect(care).toBeChecked();
  await expect(full).not.toBeChecked();
  await care.press("ArrowUp");
  await expect(store).toBeChecked();
  await expect(region.getByRole("button", { name: "Store documents" })).toBeVisible();
  await expect(store.locator("xpath=..")).toHaveClass(/selected/);
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(store).toBeVisible();
    await expect(care).toBeVisible();
    await expect(full).toBeVisible();
    expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});

test("stores an original PDF without starting import review and previews the same bytes", async ({ page }) => {
  const region = await openUploadModes(page);

  const stamp = Date.now(), name = `stored-only-${stamp}.pdf`;
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), pdfPage = pdf.addPage([612, 792]);
  pdfPage.drawText(`Synthetic storage-only browser fixture ${stamp}`, { x: 40, y: 730, font, size: 12 });
  await region.getByRole("radio", { name: /Store only/ }).click();
  await region.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await region.getByRole("button", { name: "Store documents" }).click();

  await expect(page.getByRole("heading", { name: "Review imported documents" })).toHaveCount(0);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.locator(".authoritative-document-preview iframe")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("link", { name: "Download original" })).toBeVisible();
});
