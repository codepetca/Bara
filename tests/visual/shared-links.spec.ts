import { expect, test } from "@playwright/test";

test.describe("shared attendance links", () => {
  test("copied public links load for tap attendance and qr attendance", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy manual attendance link" }).click();
    const manualUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(manualUrl).toBe(`${baseURL}/s/edit/visual-check-in-token`);

    await page.goto(manualUrl);
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name or student ID")).toBeVisible();

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy attendance QR link" }).click();
    const qrUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(qrUrl).toBe(`${baseURL}/s/display/visual-check-in-token`);

    await page.goto(qrUrl);
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.getByLabel("2 of 4 students marked present")).toBeVisible();
  });
});
