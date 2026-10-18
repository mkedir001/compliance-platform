import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

test("stores an original PDF without starting import review and previews the same bytes", async ({ page }) => {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button", { name: "Import documents", exact: true }).click();

  const stamp = Date.now(), name = `stored-only-${stamp}.pdf`;
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), pdfPage = pdf.addPage([612, 792]);
  pdfPage.drawText(`Synthetic storage-only browser fixture ${stamp}`, { x: 40, y: 730, font, size: 12 });
  const region = page.getByRole("region", { name: "Import documents for this client" });
  await region.getByRole("radio", { name: /Store only/ }).click();
  await region.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await region.getByRole("button", { name: "Store documents" }).click();

  await expect(page.getByRole("heading", { name: "Review imported documents" })).toHaveCount(0);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.locator(".authoritative-document-preview iframe")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("link", { name: "Download original" })).toBeVisible();
});
