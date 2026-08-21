import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BARA_PRODUCTION_ORIGIN,
  BARA_WORKOS_API_KEY_SHA256_ALLOWLISTS,
  BARA_WORKOS_CLIENT_IDS,
  PIKA_PRODUCTION_ORIGIN,
  auditBaraAttendanceRolloutEnvironment,
  auditBaraDeploymentEnvironment,
  resolveBaraDeploymentTarget,
  resolveBaraRolloutTarget,
} from "./bara-rollout-rules.mjs";

const previewTestKey = `sk_test_${"a".repeat(40)}`;
const productionTestKey = `sk_${"b".repeat(64)}`;

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

const target = {
  stage: "preview",
  expectedBaraOrigin: "https://bara-preview.example.test",
  expectedPikaOrigin: "https://pika-preview.example.test",
  expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS.preview,
  expectedWorkosApiKeySha256Allowlist: [fingerprint(previewTestKey)],
};

function readyEnvironment() {
  return {
    CONVEX_DEPLOY_KEY: "preview:team:project|opaque",
    WORKOS_CLIENT_ID: BARA_WORKOS_CLIENT_IDS.preview,
    WORKOS_API_KEY: previewTestKey,
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

describe("resolveBaraDeploymentTarget", () => {
  it("pins production to Bara's canonical origin instead of Vercel's generated project URL", () => {
    expect(
      resolveBaraDeploymentTarget({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "bara-generated.vercel.app",
      }),
    ).toEqual({
      stage: "production",
      expectedBaraOrigin: BARA_PRODUCTION_ORIGIN,
      expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS.production,
      expectedWorkosApiKeySha256Allowlist:
        BARA_WORKOS_API_KEY_SHA256_ALLOWLISTS.production,
    });
  });

  it("keeps preview builds bound to their exact Vercel branch URL", () => {
    expect(
      resolveBaraDeploymentTarget({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "bara-feature.example.vercel.app",
      }),
    ).toEqual({
      stage: "preview",
      expectedBaraOrigin: "https://bara-feature.example.vercel.app",
      expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS.preview,
      expectedWorkosApiKeySha256Allowlist: BARA_WORKOS_API_KEY_SHA256_ALLOWLISTS.preview,
    });
  });

  it("rejects unsupported or incomplete Vercel targets", () => {
    expect(resolveBaraDeploymentTarget({ VERCEL_ENV: "development" })).toBeNull();
    expect(resolveBaraDeploymentTarget({ VERCEL_ENV: "preview" })).toBeNull();
  });
});

describe("resolveBaraRolloutTarget", () => {
  it("requires the canonical Bara origin for production", () => {
    expect(
      resolveBaraRolloutTarget({
        stage: "production",
        expectedBaraOrigin: "https://bara-generated.vercel.app",
        expectedPikaOrigin: PIKA_PRODUCTION_ORIGIN,
      }),
    ).toBeNull();

    expect(
      resolveBaraRolloutTarget({
        stage: "production",
        expectedBaraOrigin: BARA_PRODUCTION_ORIGIN,
        expectedPikaOrigin: PIKA_PRODUCTION_ORIGIN,
      }),
    ).toEqual({
      stage: "production",
      expectedBaraOrigin: BARA_PRODUCTION_ORIGIN,
      expectedPikaOrigin: PIKA_PRODUCTION_ORIGIN,
      expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS.production,
      expectedWorkosApiKeySha256Allowlist:
        BARA_WORKOS_API_KEY_SHA256_ALLOWLISTS.production,
    });
  });

  it("requires the canonical Pika origin for production", () => {
    for (const expectedPikaOrigin of [
      "https://attacker.example",
      `${PIKA_PRODUCTION_ORIGIN}/attendance`,
      `${PIKA_PRODUCTION_ORIGIN}?target=other`,
    ]) {
      expect(
        resolveBaraRolloutTarget({
          stage: "production",
          expectedBaraOrigin: BARA_PRODUCTION_ORIGIN,
          expectedPikaOrigin,
        }),
      ).toBeNull();
    }
  });

  it("retains an explicit preview branch origin", () => {
    expect(
      resolveBaraRolloutTarget({
        stage: "preview",
        expectedBaraOrigin: "https://bara-feature.example.vercel.app",
        expectedPikaOrigin: "https://pika-feature.example.vercel.app",
      }),
    ).toMatchObject({
      stage: "preview",
      expectedBaraOrigin: "https://bara-feature.example.vercel.app",
      expectedPikaOrigin: "https://pika-feature.example.vercel.app",
    });
  });
});

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

  it("accepts an opaque application-scoped key with the exact production fingerprint", () => {
    const productionTarget = {
      ...resolveBaraDeploymentTarget({ VERCEL_ENV: "production" }),
      expectedWorkosApiKeySha256Allowlist: [fingerprint(productionTestKey)],
    };
    const environment = readyEnvironment();
    environment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";
    environment.WORKOS_CLIENT_ID = BARA_WORKOS_CLIENT_IDS.production;
    environment.WORKOS_API_KEY = productionTestKey;
    environment.NEXT_PUBLIC_APP_URL = BARA_PRODUCTION_ORIGIN;
    environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI = `${BARA_PRODUCTION_ORIGIN}/callback`;

    expect(
      auditBaraDeploymentEnvironment(environment, productionTarget),
    ).toEqual({
      ready: true,
      stage: "production",
      passedCount: 6,
      checkCount: 6,
      failedChecks: [],
    });
  });

  it("rejects a WorkOS client from the other stage", () => {
    const previewEnvironment = readyEnvironment();
    previewEnvironment.WORKOS_CLIENT_ID = BARA_WORKOS_CLIENT_IDS.production;

    const productionEnvironment = readyEnvironment();
    productionEnvironment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";
    productionEnvironment.WORKOS_CLIENT_ID = BARA_WORKOS_CLIENT_IDS.preview;
    productionEnvironment.WORKOS_API_KEY = `sk_${"b".repeat(64)}`;

    expect(
      auditBaraDeploymentEnvironment(previewEnvironment, target).failedChecks,
    ).toContain("workos_client_and_key_fingerprint");
    expect(
      auditBaraDeploymentEnvironment(productionEnvironment, {
        ...target,
        stage: "production",
        expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS.production,
        expectedWorkosApiKeySha256Allowlist: [fingerprint(productionTestKey)],
      }).failedChecks,
    ).toContain("workos_client_and_key_fingerprint");
  });

  it("rejects a plausible opaque key that does not match the pinned fingerprint", () => {
    const environment = readyEnvironment();
    environment.WORKOS_API_KEY = `sk_${"c".repeat(64)}`;

    expect(auditBaraDeploymentEnvironment(environment, target).failedChecks).toContain(
      "workos_client_and_key_fingerprint",
    );
  });

  it("accepts either fingerprint during a controlled key rotation window", () => {
    const nextPreviewKey = `sk_${"d".repeat(64)}`;
    const rotatingTarget = {
      ...target,
      expectedWorkosApiKeySha256Allowlist: [
        fingerprint(previewTestKey),
        fingerprint(nextPreviewKey),
      ],
    };

    const currentEnvironment = readyEnvironment();
    const nextEnvironment = readyEnvironment();
    nextEnvironment.WORKOS_API_KEY = nextPreviewKey;

    expect(auditBaraDeploymentEnvironment(currentEnvironment, rotatingTarget).ready).toBe(true);
    expect(auditBaraDeploymentEnvironment(nextEnvironment, rotatingTarget).ready).toBe(true);
  });

  it("fails closed when a fingerprint allowlist contains an invalid digest", () => {
    const environment = readyEnvironment();

    expect(
      auditBaraDeploymentEnvironment(environment, {
        ...target,
        expectedWorkosApiKeySha256Allowlist: [fingerprint(previewTestKey), "invalid"],
      }).failedChecks,
    ).toContain("workos_client_and_key_fingerprint");
  });

  it("rejects missing or implausibly short opaque API keys", () => {
    const environment = readyEnvironment();

    environment.WORKOS_API_KEY = "sk_short";
    expect(auditBaraDeploymentEnvironment(environment, target).failedChecks).toContain(
      "workos_client_and_key_fingerprint",
    );

    environment.WORKOS_API_KEY = "";
    expect(auditBaraDeploymentEnvironment(environment, target).failedChecks).toContain(
      "workos_client_and_key_fingerprint",
    );
  });

  it("rejects whitespace-contaminated WorkOS credentials", () => {
    const leadingClientWhitespace = readyEnvironment();
    leadingClientWhitespace.WORKOS_CLIENT_ID = ` ${BARA_WORKOS_CLIENT_IDS.preview}`;

    const trailingClientWhitespace = readyEnvironment();
    trailingClientWhitespace.WORKOS_CLIENT_ID = `${BARA_WORKOS_CLIENT_IDS.preview}\n`;

    const leadingKeyWhitespace = readyEnvironment();
    leadingKeyWhitespace.WORKOS_API_KEY = ` ${previewTestKey}`;

    const trailingKeyWhitespace = readyEnvironment();
    trailingKeyWhitespace.WORKOS_API_KEY = `${previewTestKey}\n`;

    for (const environment of [
      leadingClientWhitespace,
      trailingClientWhitespace,
      leadingKeyWhitespace,
      trailingKeyWhitespace,
    ]) {
      expect(auditBaraDeploymentEnvironment(environment, target).failedChecks).toContain(
        "workos_client_and_key_fingerprint",
      );
    }
  });

  it("pins the resolved production target to the configured production key fingerprint", () => {
    const environment = readyEnvironment();
    environment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";
    environment.WORKOS_CLIENT_ID = BARA_WORKOS_CLIENT_IDS.production;
    environment.WORKOS_API_KEY = productionTestKey;
    environment.NEXT_PUBLIC_APP_URL = BARA_PRODUCTION_ORIGIN;
    environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI = `${BARA_PRODUCTION_ORIGIN}/callback`;

    expect(
      auditBaraDeploymentEnvironment(
        environment,
        resolveBaraDeploymentTarget({ VERCEL_ENV: "production" }),
      ).failedChecks,
    ).toContain("workos_client_and_key_fingerprint");
  });

  it("rejects Vercel's generated project origin in a production-shaped environment", () => {
    const productionTarget = {
      ...resolveBaraDeploymentTarget({ VERCEL_ENV: "production" }),
      expectedWorkosApiKeySha256Allowlist: [fingerprint(productionTestKey)],
    };
    const environment = readyEnvironment();
    environment.CONVEX_DEPLOY_KEY = "prod:deployment|opaque";
    environment.WORKOS_CLIENT_ID = BARA_WORKOS_CLIENT_IDS.production;
    environment.WORKOS_API_KEY = productionTestKey;
    environment.NEXT_PUBLIC_APP_URL = "https://bara-generated.vercel.app";
    environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI =
      "https://bara-generated.vercel.app/callback";

    expect(
      auditBaraDeploymentEnvironment(environment, productionTarget).failedChecks,
    ).toEqual(["bara_origin", "workos_callback"]);
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

  it("rejects enabling the retired cross-application browser handoff", () => {
    const environment = readyEnvironment();
    environment.PIKA_BARA_AUTH_HANDOFF = "true";

    expect(auditBaraAttendanceRolloutEnvironment(environment, target).failedChecks).toEqual([
      "legacy_browser_handoff_disabled",
    ]);
  });
});
