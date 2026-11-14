import { expect, test } from "@playwright/test";

test("room display keeps one QR while idle and hides it when disconnected", async ({ page }) => {
  await page.goto("/visual-test/room-review?state=empty");
  await expect(page.getByRole("img", { name: "Scan to check in" })).toBeVisible();
  await page.goto("/visual-test/room-review?state=disconnected");
  await expect(page.getByText("Check in with your teacher")).toBeVisible();
  await expect(page.getByRole("img", { name: "Scan to check in" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Scan to move a class" })).toHaveCount(0);
  await page.goto("/visual-test/room-review?state=idle");
  await expect(page.getByText("Check-in is closed")).toBeVisible();
  await expect(page.getByRole("img", { name: "Scan to move a class" })).toBeVisible();
  await expect(page.getByText("Welcome to class")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Scan to check in" })).toHaveCount(0);
});

test("a dual-role user chooses student check-in and sees each outcome", async ({ page }) => {
  await page.goto("/visual-test/room-review?state=scan");
  await expect(page.getByRole("button", { name: "Manage room" })).toBeVisible();
  await page.getByRole("button", { name: "Check in as student" }).click();
  await expect(page.getByText("Class A: Checked in")).toBeVisible();
  await expect(page.getByText("Class B: Please ask your teacher")).toBeVisible();
});
