import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3200;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  webServer: {
    command: `ENABLE_VISUAL_TEST_ROUTES=1 pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    cwd: path.resolve(__dirname),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1200 },
      },
    },
  ],
});
