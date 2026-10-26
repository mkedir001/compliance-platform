import { expect, test, type Page } from "@playwright/test";

const stepLabels = [
  "Person",
  "Services",
  "Legal representative",
  "Case manager",
  "Emergency contacts",
  "Health",
  "Medications",
  "Person-centered",
  "Rights",
  "Release of information",
  "Review & documents",
];

async function enterVisualQa(page: Page) {
  await page.goto("/dev/visual-qa");
  await page.getByRole("button", { name: "Enter visual QA as organization owner" }).click();
  await page.waitForURL(/\/admin\/compliance-operations/);
}

async function openClientIntake(page: Page) {
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.locator(".client-directory-row").first().click();
  await page.getByRole("button", { name: "Intake", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Client intake|Update client information/ })).toBeVisible();
}

test("intake step cards remain legible, ordered, navigable, and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1166, height: 900 });
  await enterVisualQa(page);
  await openClientIntake(page);

  const steps = page.getByRole("list", { name: /Intake steps|Client information sections/ });
  await expect(steps).toBeVisible();
  const buttons = steps.getByRole("button");
  await expect(buttons).toHaveCount(stepLabels.length);

  for (const [index, label] of stepLabels.entries()) {
    const button = buttons.nth(index);
    await expect(button).toHaveAccessibleName(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (Complete|Saved, needs attention|Not yet saved)$`));
    await expect(button).toBeVisible();
  }

  const inactive = steps.locator("button:not([aria-current='step'])").first();
  const inactiveColors = await inactive.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  expect(inactiveColors.background).toBe("rgb(255, 255, 255)");
  expect(inactiveColors.foreground).not.toBe(inactiveColors.background);

  const active = steps.locator("button[aria-current='step']");
  await expect(active).toHaveCSS("background-color", "rgb(23, 62, 49)");
  await expect(active).toHaveCSS("color", "rgb(255, 255, 255)");

  const services = buttons.nth(1);
  await services.focus();
  await expect(services).toBeFocused();
  await services.press("Enter");
  await expect(page.getByRole("heading", { name: "Services", exact: true })).toBeVisible();
  await expect(services).toHaveAttribute("aria-current", "step");

  await page.getByRole("button", { name: "Next section", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Legal representative", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Services", exact: true })).toBeVisible();

  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(steps).toBeVisible();
  await expect(buttons.last()).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
