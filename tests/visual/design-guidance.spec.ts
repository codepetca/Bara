import { expect, test } from "@playwright/test";

test.describe("visual design guidance", () => {
  test("dashboard keeps the home screen hierarchy minimal", async ({ page }) => {
    await page.goto("/visual-test/home");
    await expect(page.getByRole("heading", { name: "Tapcheck" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("home-desktop.png");
  });

  test("roster detail keeps staff actions restrained", async ({ page }) => {
    await page.goto("/visual-test/roster");
    await expect(page.getByRole("heading", { name: "Grade 7 Homeroom" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("roster-desktop.png");
  });

  test("roster import preview stays quiet and readable", async ({ page }) => {
    await page.goto("/visual-test/import");
    await expect(page.getByRole("heading", { name: "Import roster" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("import-desktop.png");
  });

  test("session screen stays calm on desktop", async ({ page }) => {
    await page.goto("/visual-test/session");
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("session-desktop.png");
  });

  test("session screen stays usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/visual-test/session");
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("session-mobile.png");
  });

  test("display screen keeps the QR presentation minimal", async ({ page }) => {
    await page.goto("/visual-test/display");
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("display-desktop.png");
  });

  test("student check-in screen is glanceable after a qr scan", async ({ page }) => {
    await page.goto("/visual-test/check-in");
    await expect(page.getByRole("heading", { name: "Naomi Adams" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("check-in-desktop.png", {
      maxDiffPixels: 1200,
    });
  });
});
