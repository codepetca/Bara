import { createHash, timingSafeEqual } from "node:crypto";

const INSTALLATION_REF_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export const BARA_PRODUCTION_ORIGIN = "https://bara-attendance.vercel.app";
export const BARA_WORKOS_CLIENT_IDS = Object.freeze({
  preview: "client_01M01P1VPJA97MECDPPMJ0SGXY",
  production: "client_01M01P1W1WTRT8K3VVBXW3VH8Y",
});
export const BARA_WORKOS_API_KEY_SHA256 = Object.freeze({
  preview: "e2435baac3470b4310ecf0346d27ea38a8fdfe8507934fedbe1ae5cc3acb27b8",
  production: "14242d85371f385a8eb48023fd11921efb06c52e1ccc5831564f9586dc497c3a",
});

export function workosExpectationsForStage(stage) {
  if (stage !== "preview" && stage !== "production") return null;

  return {
    expectedWorkosClientId: BARA_WORKOS_CLIENT_IDS[stage],
    expectedWorkosApiKeySha256: BARA_WORKOS_API_KEY_SHA256[stage],
  };
}

export function resolveBaraDeploymentTarget(environment) {
  if (environment.VERCEL_ENV === "production") {
    return {
      stage: "production",
      expectedBaraOrigin: BARA_PRODUCTION_ORIGIN,
      ...workosExpectationsForStage("production"),
    };
  }

  if (environment.VERCEL_ENV === "preview" && environment.VERCEL_BRANCH_URL) {
    return {
      stage: "preview",
      expectedBaraOrigin: `https://${environment.VERCEL_BRANCH_URL}`,
      ...workosExpectationsForStage("preview"),
    };
  }

  return null;
}

function trimmed(value) {
  return value?.trim() ?? "";
}

function exactHttpsUrl(value, expected) {
  try {
    const actualUrl = new URL(trimmed(value));
    const expectedUrl = new URL(expected);
    return (
      actualUrl.protocol === "https:" &&
      expectedUrl.protocol === "https:" &&
      actualUrl.href === expectedUrl.href &&
      actualUrl.username === "" &&
      actualUrl.password === "" &&
      expectedUrl.username === "" &&
      expectedUrl.password === ""
    );
  } catch {
    return false;
  }
}

function exactHttpsOrigin(value, expected) {
  try {
    const actualUrl = new URL(trimmed(value));
    const expectedUrl = new URL(expected);
    return (
      actualUrl.protocol === "https:" &&
      expectedUrl.protocol === "https:" &&
      actualUrl.origin === expectedUrl.origin &&
      actualUrl.pathname === "/" &&
      actualUrl.search === "" &&
      actualUrl.hash === "" &&
      actualUrl.username === "" &&
      actualUrl.password === "" &&
      expectedUrl.pathname === "/" &&
      expectedUrl.search === "" &&
      expectedUrl.hash === "" &&
      expectedUrl.username === "" &&
      expectedUrl.password === ""
    );
  } catch {
    return false;
  }
}

function hasSecret(value, minimumLength = 32) {
  return (value ?? "").length >= minimumLength;
}

function allDistinct(values) {
  const normalized = values.map((value) => value ?? "");
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length;
}

function deployKeyMatchesStage(value, stage) {
  const deployKey = trimmed(value);
  return stage === "preview" ? deployKey.startsWith("preview:") : deployKey.startsWith("prod:");
}

function matchesSha256(value, expectedHexDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedHexDigest ?? "")) return false;

  const actualDigest = createHash("sha256").update(value).digest();
  const expectedDigest = Buffer.from(expectedHexDigest, "hex");
  return timingSafeEqual(actualDigest, expectedDigest);
}

function workosCredentialsMatchTarget(environment, target) {
  // AuthKit consumes these environment values verbatim. Comparing the raw
  // strings ensures whitespace-contaminated credentials fail before deploy.
  const clientId = environment.WORKOS_CLIENT_ID ?? "";
  const apiKey = environment.WORKOS_API_KEY ?? "";

  return (
    clientId === target.expectedWorkosClientId &&
    apiKey.startsWith("sk_") &&
    apiKey.length >= 40 &&
    matchesSha256(apiKey, target.expectedWorkosApiKeySha256)
  );
}

function auditResult(stage, checks) {
  const failedChecks = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return {
    ready: failedChecks.length === 0,
    stage,
    passedCount: checks.length - failedChecks.length,
    checkCount: checks.length,
    failedChecks,
  };
}

export function auditBaraDeploymentEnvironment(environment, target) {
  return auditResult(target.stage, deploymentChecks(environment, target));
}

function deploymentChecks(environment, target) {
  return [
    ["convex_deploy_key_scope", deployKeyMatchesStage(environment.CONVEX_DEPLOY_KEY, target.stage)],
    [
      "workos_client_and_key_fingerprint",
      workosCredentialsMatchTarget(environment, target),
    ],
    ["workos_cookie_password", hasSecret(environment.WORKOS_COOKIE_PASSWORD)],
    ["workos_cookie_name", trimmed(environment.WORKOS_COOKIE_NAME) === "bara-wos-session"],
    ["bara_origin", exactHttpsOrigin(environment.NEXT_PUBLIC_APP_URL, target.expectedBaraOrigin)],
    [
      "workos_callback",
      exactHttpsUrl(
        environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
        `${target.expectedBaraOrigin}/callback`,
      ),
    ],
  ];
}

export function auditBaraAttendanceRolloutEnvironment(environment, target) {
  const expectedEventUrl = `${target.expectedPikaOrigin}/api/integrations/attendance/v1/events`;
  const checks = [
    ...deploymentChecks(environment, target),
    ["legacy_browser_handoff_disabled", environment.PIKA_BARA_AUTH_HANDOFF !== "true"],
    ["attendance_integration_enabled", environment.PIKA_ATTENDANCE_INTEGRATION === "true"],
    [
      "attendance_transport",
      INSTALLATION_REF_PATTERN.test(trimmed(environment.PIKA_INTEGRATION_REF)) &&
        hasSecret(environment.PIKA_INTEGRATION_SECRET),
    ],
    ["event_delivery_url", exactHttpsUrl(environment.PIKA_EVENT_DELIVERY_URL, expectedEventUrl)],
    ["event_delivery_secret", hasSecret(environment.PIKA_EVENT_DELIVERY_SECRET)],
    [
      "distinct_secrets",
      allDistinct([
        environment.WORKOS_COOKIE_PASSWORD,
        environment.PIKA_INTEGRATION_SECRET,
        environment.PIKA_EVENT_DELIVERY_SECRET,
      ]),
    ],
  ];

  return auditResult(target.stage, checks);
}
