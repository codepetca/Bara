import { expect, test } from "@playwright/test";
import { brand } from "@/config/brand";

test.describe("visual design guidance", () => {
  test("dashboard keeps the home screen hierarchy minimal", async ({ page }) => {
    await page.goto("/visual-test/home");
    await expect(page.getByRole("heading", { name: brand.name })).toBeVisible();
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
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/visual-test/display");
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    const qrStage = page.getByTestId("classroom-qr-stage");
    const qrStageBox = await qrStage.boundingBox();

    expect(qrStageBox).not.toBeNull();
    expect(qrStageBox!.width).toBeGreaterThan(900);
    expect(Math.abs(qrStageBox!.width - qrStageBox!.height)).toBeLessThan(1);
    await expect(page.locator("main")).toHaveScreenshot("display-desktop.png");
  });

  test("closed display preserves the full-screen QR footprint", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/visual-test/display-closed");
    await expect(page.getByText("Attendance is closed")).toBeVisible();
    const qrStageBox = await page.getByTestId("classroom-qr-stage").boundingBox();

    expect(qrStageBox).not.toBeNull();
    expect(qrStageBox!.width).toBeGreaterThan(900);
    expect(Math.abs(qrStageBox!.width - qrStageBox!.height)).toBeLessThan(1);
    await expect(page.locator("main")).toHaveScreenshot("display-closed-desktop.png");
  });

  test("display keeps the QR square on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/visual-test/display");
    const qrStageBox = await page.getByTestId("classroom-qr-stage").boundingBox();

    expect(qrStageBox).not.toBeNull();
    expect(qrStageBox!.width).toBeGreaterThan(300);
    expect(Math.abs(qrStageBox!.width - qrStageBox!.height)).toBeLessThan(1);
    await expect(page.locator("main")).toHaveScreenshot("display-mobile.png", {
      maxDiffPixels: 1200,
    });
  });

  test("student check-in screen is glanceable after a qr scan", async ({ page }) => {
    await page.goto("/visual-test/check-in");
    await expect(page.getByRole("heading", { name: "Naomi Adams" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("check-in-desktop.png", {
      maxDiffPixels: 1200,
    });
  });
});
