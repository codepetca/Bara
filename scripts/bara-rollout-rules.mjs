const INSTALLATION_REF_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export const BARA_PRODUCTION_PIKA_ORIGIN = "https://pika.codepet.ca";

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

function workosCredentialsMatchStage(environment, stage) {
  const clientId = trimmed(environment.WORKOS_CLIENT_ID);
  const apiKey = trimmed(environment.WORKOS_API_KEY);
  return (
    clientId.startsWith("client_") &&
    (stage === "preview" ? apiKey.startsWith("sk_test_") : apiKey.startsWith("sk_live_"))
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
    ["workos_environment", workosCredentialsMatchStage(environment, target.stage)],
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
    [
      target.attendanceMode === "pre-enable"
        ? "attendance_integration_disabled_for_preflight"
        : "attendance_integration_enabled",
      environment.PIKA_ATTENDANCE_INTEGRATION ===
        (target.attendanceMode === "pre-enable" ? "false" : "true"),
    ],
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
