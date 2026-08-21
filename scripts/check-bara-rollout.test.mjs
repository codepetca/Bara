import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BARA_PRODUCTION_ORIGIN,
  PIKA_PRODUCTION_ORIGIN,
} from "./bara-rollout-rules.mjs";

const scriptPath = path.resolve(process.cwd(), "scripts/check-bara-rollout.mjs");

function runProductionPreflight(
  expectedBaraOrigin,
  expectedPikaOrigin = PIKA_PRODUCTION_ORIGIN,
) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--stage",
      "production",
      "--expected-bara-origin",
      expectedBaraOrigin,
      "--expected-pika-origin",
      expectedPikaOrigin,
    ],
    {
      encoding: "utf8",
      env: {
        CONVEX_DEPLOY_KEY: "prod:deployment|test",
        NEXT_PUBLIC_APP_URL: expectedBaraOrigin,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${expectedBaraOrigin}/callback`,
        WORKOS_API_KEY: `sk_${"a".repeat(64)}`,
        WORKOS_CLIENT_ID: "client_test",
        WORKOS_COOKIE_NAME: "bara-wos-session",
        WORKOS_COOKIE_PASSWORD: "cookie-password-that-is-long-enough",
      },
    },
  );
}

describe("check-bara-rollout CLI", () => {
  it("rejects a non-canonical production Bara origin before auditing environment values", () => {
    const result = runProductionPreflight("https://bara-generated.vercel.app");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("production must use both canonical origins");
  });

  it("rejects a non-canonical production Pika origin before auditing environment values", () => {
    const result = runProductionPreflight(
      BARA_PRODUCTION_ORIGIN,
      "https://attacker.example",
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("production must use both canonical origins");
  });

  it("accepts the canonical production target and proceeds to the environment audit", () => {
    const result = runProductionPreflight(BARA_PRODUCTION_ORIGIN);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      stage: "production",
      failedChecks: expect.arrayContaining([
        "workos_client_and_key_fingerprint",
        "attendance_integration_enabled",
      ]),
    });
  });
});
