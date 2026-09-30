import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "react-qr-code";
import { visualSessionFixture } from "../../lib/visual-fixtures";

const { checkInToken, staffShareToken } = visualSessionFixture.session;

test.describe("shared attendance links", () => {
  test("copied staff links load and the QR still encodes the student check-in link", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy manual attendance link" }).click();
    const manualUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(manualUrl).toBe(`${baseURL}/s/edit/${staffShareToken}`);

    await page.goto(manualUrl);
    await expect(page.getByRole("heading", { name: "Homeroom" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name or student ID")).toBeVisible();

    await page.goto("/visual-test/roster");

    await page.getByRole("button", { name: "Copy attendance QR link" }).click();
    const qrUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(qrUrl).toBe(`${baseURL}/s/display/${staffShareToken}`);

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

  for (const route of ["edit", "display"]) {
    test(`student check-in token cannot open the synthetic staff ${route} fixture`, async ({ page }) => {
      // This fixture-only rejection is deterministic and does not query a live backend.
      const response = await page.goto(`/s/${route}/${checkInToken}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Homeroom" })).toHaveCount(0);
      await expect(page.getByPlaceholder("Search name or student ID")).toHaveCount(0);
      await expect(page.getByRole("img", { name: "QR Code" })).toHaveCount(0);
      await expect(page.getByText("Naomi Adams")).toHaveCount(0);
    });
  }
});
