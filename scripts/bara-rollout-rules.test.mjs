import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BARA_PRODUCTION_PIKA_ORIGIN,
  auditBaraAttendanceRolloutEnvironment,
  auditBaraDeploymentEnvironment,
} from "./bara-rollout-rules.mjs";

const target = {
  stage: "preview",
  expectedBaraOrigin: "https://bara-preview.example.test",
  expectedPikaOrigin: "https://pika-preview.example.test",
  attendanceMode: "enabled",
};

function readyEnvironment() {
  return {
    CONVEX_DEPLOY_KEY: "preview:team:project|opaque",
    WORKOS_CLIENT_ID: "client_preview",
    WORKOS_API_KEY: "sk_test_opaque",
    WORKOS_COOKIE_PASSWORD: "cookie-password-that-is-long-enough-01",
    WORKOS_COOKIE_NAME: "bara-wos-session",
    NEXT_PUBLIC_APP_URL: target.expectedBaraOrigin,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${target.expectedBaraOrigin}/callback`,
    PIKA_BARA_AUTH_HANDOFF: "false",
    PIKA_ATTENDANCE_INTEGRATION: "true",
    PIKA_INTEGRATION_REF: "pika-preview",
    PIKA_INTEGRATION_SECRET: "integration-secret-that-is-long-enough-03",
    PIKA_EVENT_DELIVERY_URL: `${target.expectedPikaOrigin}/api/integrations/attendance/v1/events`,
    PIKA_EVENT_DELIVERY_SECRET: "event-secret-that-is-long-enough-0004",
  };
}

describe("auditBaraDeploymentEnvironment", () => {
  it("accepts a preview-scoped deployment environment", () => {
    expect(auditBaraDeploymentEnvironment(readyEnvironment(), target)).toEqual({
      ready: true,
      stage: "preview",
      passedCount: 6,
      checkCount: 6,
      failedChecks: [],
    });
  });

  it("rejects production deploy keys and non-exact callback URLs in preview", () => {
    const environment = readyEnvironment();
    environment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";
    environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI = `${target.expectedBaraOrigin}/callback?next=/`;

    expect(auditBaraDeploymentEnvironment(environment, target).failedChecks).toEqual([
      "convex_deploy_key_scope",
      "workos_callback",
    ]);
  });

  it("requires live WorkOS credentials for production", () => {
    const environment = readyEnvironment();
    environment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";

    expect(
      auditBaraDeploymentEnvironment(environment, {
        ...target,
        stage: "production",
      }).failedChecks,
    ).toContain("workos_environment");
  });
});

describe("auditBaraAttendanceRolloutEnvironment", () => {
  it("accepts the complete activation environment without returning values", () => {
    const result = auditBaraAttendanceRolloutEnvironment(readyEnvironment(), target);

    expect(result.ready).toBe(true);
    expect(JSON.stringify(result)).not.toContain("opaque");
    expect(JSON.stringify(result)).not.toContain("secret-that-is-long");
  });

  it("rejects disabled integration, secret reuse, and an unexpected event path", () => {
    const environment = readyEnvironment();
    environment.PIKA_ATTENDANCE_INTEGRATION = "false";
    environment.PIKA_EVENT_DELIVERY_URL = `${target.expectedPikaOrigin}/api/events`;
    environment.PIKA_EVENT_DELIVERY_SECRET = environment.PIKA_INTEGRATION_SECRET;

    expect(auditBaraAttendanceRolloutEnvironment(environment, target).failedChecks).toEqual([
      "attendance_integration_enabled",
      "event_delivery_url",
      "distinct_secrets",
    ]);
  });

  it("accepts disabled integration for the pre-enable credential smoke", () => {
    const environment = readyEnvironment();
    environment.PIKA_ATTENDANCE_INTEGRATION = "false";
    const result = auditBaraAttendanceRolloutEnvironment(environment, {
      ...target,
      attendanceMode: "pre-enable",
    });
    expect(result.ready).toBe(true);
  });

  it("rejects enabling the retired cross-application browser handoff", () => {
    const environment = readyEnvironment();
    environment.PIKA_BARA_AUTH_HANDOFF = "true";

    expect(auditBaraAttendanceRolloutEnvironment(environment, target).failedChecks).toEqual([
      "legacy_browser_handoff_disabled",
    ]);
  });
});

describe("guarded Vercel production build", () => {
  it("rejects a wrong Pika callback origin before starting Convex deployment", () => {
    const environment = {
      ...readyEnvironment(),
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "bara.codepet.ca",
      CONVEX_DEPLOY_KEY: "prod:team:project|opaque",
      WORKOS_CLIENT_ID: "client_production",
      WORKOS_API_KEY: "sk_live_opaque",
      NEXT_PUBLIC_APP_URL: "https://bara.codepet.ca",
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://bara.codepet.ca/callback",
      PIKA_ATTENDANCE_INTEGRATION: "false",
      PIKA_EVENT_DELIVERY_URL: "https://relay.example/api/integrations/attendance/v1/events",
    };
    const result = spawnSync(process.execPath, [resolve("scripts/vercel-build.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });

    expect(BARA_PRODUCTION_PIKA_ORIGIN).toBe("https://pika.codepet.ca");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ready: false,
      stage: "production",
      failedChecks: ["event_delivery_url"],
    });
  });
});
