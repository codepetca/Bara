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

test("the room QR stays vertically centered on an iPad", async ({ page }) => {
  const viewport = { width: 1024, height: 680 };
  await page.setViewportSize(viewport);
  await page.goto("/visual-test/room-review");
  const open = page.getByRole("img", { name: "Scan to check in" });
  await expect(open).toBeVisible();
  const liveBounds = await open.boundingBox();
  expect(liveBounds!.y + liveBounds!.height / 2).toBeCloseTo(viewport.height / 2, 0);
  expect(liveBounds!.height).toBeGreaterThan(460);
  await page.goto("/visual-test/room-review?state=idle");
  const closed = page.getByRole("img", { name: "Scan to move a class" });
  await expect(closed).toBeVisible();
  expect(await closed.boundingBox()).toEqual(liveBounds);

  const label = page.getByText("iPad 220");
  await expect(label).toBeVisible();
  const labelBounds = await label.boundingBox();
  const titleBounds = await page.getByRole("heading", { name: "Room 220" }).boundingBox();
  expect(labelBounds!.x).toBe(titleBounds!.x);
  expect(viewport.height - (labelBounds!.y + labelBounds!.height)).toBeCloseTo(titleBounds!.y, 0);
});

test("the room QR uses the available width in iPad portrait", async ({ page }) => {
  const viewport = { width: 768, height: 936 };
  await page.setViewportSize(viewport);
  await page.goto("/visual-test/room-review?state=empty");
  const code = page.getByRole("img", { name: "Scan to check in" });
  await expect(code).toBeVisible();
  const bounds = await code.boundingBox();
  expect(bounds!.width).toBeGreaterThan(620);
  expect(bounds!.y + bounds!.height / 2).toBeCloseTo(viewport.height / 2, 0);
});

for (const { viewport, longLabel } of [
  { viewport: { width: 1024, height: 680 }, longLabel: "Accelerated Chemistry Lab 220" },
  { viewport: { width: 768, height: 936 }, longLabel: "Health and Physical Education Multipurpose Classroom" },
]) {
  test(`Room 223 headings fit above the closed QR at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/visual-test/room-review?state=idle-empty");
    const room = page.getByRole("heading", { name: "223" });
    const status = page.getByRole("heading", { name: "Check-in is closed" });
    const qr = page.getByRole("img", { name: "Scan to move a class" });

    await expect(room).toBeVisible();
    await expect(status).toBeVisible();
    expect(await room.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(50);
    expect(await status.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(30);
    const [roomBounds, statusBounds, qrBounds] = await Promise.all([room.boundingBox(), status.boundingBox(), qr.boundingBox()]);
    expect(Math.max(roomBounds!.y + roomBounds!.height, statusBounds!.y + statusBounds!.height)).toBeLessThan(qrBounds!.y);
    expect(qrBounds!.height).toBeGreaterThan(460);
    expect(qrBounds!.y + qrBounds!.height / 2).toBeCloseTo(viewport.height / 2, 0);
    expect(await page.locator("main").evaluate((element) => element.scrollHeight)).toBe(viewport.height);
  });

  test(`long room names preserve the centered QR at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/visual-test/room-review?state=idle-empty&label=${encodeURIComponent(longLabel)}`);
    await expect(page.getByRole("heading", { name: longLabel })).toBeVisible();
    const qr = page.getByRole("img", { name: "Scan to move a class" });
    await expect(qr).toBeInViewport();
    const bounds = (await qr.boundingBox())!;
    expect(bounds.y + bounds.height / 2).toBeCloseTo(viewport.height / 2, 0);
    expect(await page.locator("main").evaluate((element) => element.scrollHeight)).toBe(viewport.height);
  });
}

test("an idle room display can reload itself for a new build", async ({ page, request }) => {
  const versionResponse = await request.get("/api/display/version");
  expect(versionResponse.ok()).toBe(true);
  expect(versionResponse.headers()["cache-control"]).toContain("no-store");
  expect(await versionResponse.json()).toHaveProperty("version");

  await page.clock.install();
  let versionChecks = 0;
  await page.route("**/api/display/version", async (route) => {
    versionChecks += 1;
    await route.fulfill({ json: { version: "fixture-new" } });
  });
  await page.goto("/visual-test/room-review?state=update#display");
  const displayUrl = page.url();
  const pairingKey = "bara-room-display-credential";
  await page.evaluate((key) => localStorage.setItem(key, "fixture-credential"), pairingKey);
  await expect(page.getByText("Check-in is open")).toBeVisible();
  await page.clock.fastForward(15 * 60_000);
  expect(versionChecks).toBe(0);

  await page.getByRole("button", { name: "Close check-in" }).click();
  await expect(page.getByText("Check-in is closed")).toBeVisible();
  const reload = page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
  await page.clock.fastForward(15 * 60_000);
  await reload;
  await expect(page.getByText("Check-in is open")).toBeVisible();
  expect(page.url()).toBe(displayUrl);
  expect(await page.evaluate((key) => localStorage.getItem(key), pairingKey)).toBe("fixture-credential");
  expect(versionChecks).toBe(1);
});

test("a dual-role user chooses student check-in and sees each outcome", async ({ page }) => {
  await page.goto("/visual-test/room-review?state=scan");
  await expect(page.getByRole("button", { name: "Manage room" })).toBeVisible();
  await page.getByRole("button", { name: "Check in as student" }).click();
  await expect(page.getByText("Class A: Checked in")).toBeVisible();
  await expect(page.getByText("Class B: Please ask your teacher")).toBeVisible();
});
