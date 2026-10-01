import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "react-qr-code";
import { visualSessionFixture } from "../../lib/visual-fixtures";

const { checkInToken } = visualSessionFixture.session;

test.describe("shared attendance links", () => {
  test("copied manual links require sign-in and the public QR encodes student check-in", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy manual attendance link" }).click();
    const manualUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(manualUrl).toBe(`${baseURL}/s/edit/${checkInToken}`);

    const response = await page.request.get(manualUrl, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const signInUrl = new URL(response.headers().location);
    expect(signInUrl.protocol).toBe("https:");
    expect(signInUrl.hostname).toBe("api.workos.com");
    expect(await response.text()).not.toContain("Naomi Adams");

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy attendance QR link" }).click();
    const qrUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(qrUrl).toBe(`${baseURL}/s/display/${checkInToken}`);

    await page.goto(qrUrl);
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.getByLabel("2 of 4 students marked present")).toBeVisible();

    // Compare the actual SVG matrix rather than relying on a label or screenshot.
    const studentUrl = `${baseURL}/check-in/${checkInToken}`;
    const expectedQrMarkup = renderToStaticMarkup(createElement(QRCode, { value: studentUrl }));
    const expectedQrPaths = [...expectedQrMarkup.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);
    expect(expectedQrPaths).toHaveLength(2);
    const qr = page.getByRole("img", { name: "QR Code" });
    await expect(qr).toBeVisible();
    await expect(qr.locator("path")).toHaveCount(2);
    for (const [index, path] of expectedQrPaths.entries()) {
      await expect(qr.locator("path").nth(index)).toHaveAttribute("d", path);
    }
  });

  test("the public projector omits all roster rows and identity fields", async ({ page }) => {
    await page.goto(`/s/display/${checkInToken}`);
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name or student ID")).toHaveCount(0);
    await expect(page.getByText("Naomi Adams")).toHaveCount(0);
    await expect(page.getByText("1001", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "QR Code" })).toBeVisible();
  });
});
