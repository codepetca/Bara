import { httpRouter } from "convex/server";
import { validateV1Message } from "../lib/attendance-contract/v1/validate";
import { internal } from "./api";
import { authenticatePikaRequest, jsonResponse } from "./pikaHttp";
import { httpAction } from "./server";
import { callPikaSmokeIngress, isPikaSmokeCallbackConfigured } from "./pikaSmoke";

const ROSTER_PATH_PREFIX = "/api/integrations/pika/v1/rosters/";
const SCHEDULE_PATH_PREFIX = "/api/integrations/pika/v1/schedules/";
const SESSION_PATH_PREFIX = "/api/integrations/pika/v1/sessions/";
const SMOKE_PATH = "/api/integrations/pika/v1/smoke";

function isSmokeRequest(value: unknown): value is {
  schema_version: 1;
  kind: "attendance.auth.smoke.request";
  installation_ref: string;
  scope_ref: string;
  challenge: string;
  rollout_mode: "pre-enable" | "enabled";
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).length === 6 &&
    payload.schema_version === 1 &&
    payload.kind === "attendance.auth.smoke.request" &&
    typeof payload.installation_ref === "string" &&
    /^[A-Za-z0-9._~-]{1,128}$/.test(payload.installation_ref) &&
    typeof payload.scope_ref === "string" &&
    /^scope_[a-f0-9]{64}$/.test(payload.scope_ref) &&
    typeof payload.challenge === "string" &&
    /^smoke_[a-f0-9]{32}$/.test(payload.challenge) &&
    (payload.rollout_mode === "pre-enable" || payload.rollout_mode === "enabled");
}

const postSmoke = httpAction(async (ctx, request) => {
  const authenticated = await authenticatePikaRequest(request, { allowDisabled: true });
  if (!authenticated.ok) return authenticated.response;
  if (authenticated.url.pathname !== SMOKE_PATH || authenticated.body.length > 2_048) {
    return jsonResponse(400, { ok: false, error: "invalid_request" });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(authenticated.body);
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  if (!isSmokeRequest(payload) || payload.installation_ref !== authenticated.installationRef) {
    return jsonResponse(422, { ok: false, error: "resource_mismatch" });
  }
  const expectedIntegrationState = payload.rollout_mode === "enabled" ? "true" : "false";
  if (process.env.PIKA_ATTENDANCE_INTEGRATION !== expectedIntegrationState) {
    return jsonResponse(503, { ok: false, error: "rollout_mode_mismatch" });
  }
  if (!isPikaSmokeCallbackConfigured()) {
    return jsonResponse(503, { ok: false, error: "callback_not_configured" });
  }
  const consumed = await ctx.runMutation(internal.pikaSmoke.consumeNonce, {
    installationRef: authenticated.installationRef,
    nonce: authenticated.nonce,
    requestTimestamp: authenticated.timestampSeconds,
    now: Date.now(),
  });
  if (consumed === "replayed") {
    return jsonResponse(409, { ok: false, error: "replayed_request" });
  }
  if (consumed === "rate_limited") {
    return jsonResponse(429, { ok: false, error: "rate_limited" });
  }
  const reverseAuthenticated = await callPikaSmokeIngress({
    payload: { ...payload, kind: "attendance.auth.smoke.callback" },
  });
  if (!reverseAuthenticated) {
    return jsonResponse(503, { ok: false, error: "reverse_authentication_failed" });
  }
  return jsonResponse(200, {
    ok: true,
    checks: { pika_to_bara: true, bara_to_pika: true },
  });
});

const putRosterSnapshot = httpAction(async (ctx, request) => {
  const authenticated = await authenticatePikaRequest(request);
  if (!authenticated.ok) return authenticated.response;

  const rosterRef = authenticated.url.pathname.slice(ROSTER_PATH_PREFIX.length);
  if (!rosterRef || rosterRef.includes("/")) {
    return jsonResponse(404, { ok: false, error: "not_found" });
  }

  let input: unknown;
  try {
    input = JSON.parse(authenticated.body);
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  const validation = validateV1Message(input);
  if (!validation.ok || validation.value.message_type !== "roster.snapshot") {
    return jsonResponse(422, {
      ok: false,
      error: validation.ok ? "wrong_message_type" : validation.error,
    });
  }
  if (
    validation.value.installation_ref !== authenticated.installationRef ||
    validation.value.roster_ref !== rosterRef
  ) {
    return jsonResponse(422, { ok: false, error: "resource_mismatch" });
  }

  const result = await ctx.runMutation(internal.pikaIntegration.applyRosterSnapshot, {
    nonce: authenticated.nonce,
    requestTimestamp: authenticated.timestampSeconds,
    bodyDigest: authenticated.bodyDigest,
    payload: validation.value,
  });
  if (result.ok) return jsonResponse(200, result);

  switch (result.code) {
    case "owner_not_authorized":
    case "owner_mismatch":
      return jsonResponse(403, result);
    case "replayed_request":
    case "idempotency_conflict":
    case "stale_revision":
      return jsonResponse(409, result);
    case "integration_state_invalid":
      return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
  }
  return jsonResponse(500, { ok: false, error: "temporarily_unavailable" });
});

const putScheduleSnapshot = httpAction(async (ctx, request) => {
  const authenticated = await authenticatePikaRequest(request);
  if (!authenticated.ok) return authenticated.response;

  const rosterRef = authenticated.url.pathname.slice(SCHEDULE_PATH_PREFIX.length);
  if (!rosterRef || rosterRef.includes("/")) {
    return jsonResponse(404, { ok: false, error: "not_found" });
  }

  let input: unknown;
  try {
    input = JSON.parse(authenticated.body);
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  const validation = validateV1Message(input);
  if (!validation.ok || validation.value.message_type !== "schedule.snapshot") {
    return jsonResponse(422, {
      ok: false,
      error: validation.ok ? "wrong_message_type" : validation.error,
    });
  }
  if (
    validation.value.installation_ref !== authenticated.installationRef ||
    validation.value.roster_ref !== rosterRef
  ) {
    return jsonResponse(422, { ok: false, error: "resource_mismatch" });
  }

  const result = await ctx.runMutation(internal.pikaIntegration.applyScheduleSnapshot, {
    nonce: authenticated.nonce,
    requestTimestamp: authenticated.timestampSeconds,
    bodyDigest: authenticated.bodyDigest,
    payload: validation.value,
  });
  if (result.ok) return jsonResponse(200, result);

  switch (result.code) {
    case "roster_not_found":
      return jsonResponse(404, result);
    case "owner_not_authorized":
      return jsonResponse(403, result);
    case "replayed_request":
    case "idempotency_conflict":
    case "stale_revision":
      return jsonResponse(409, result);
    case "integration_state_invalid":
      return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
  }
  return jsonResponse(500, { ok: false, error: "temporarily_unavailable" });
});

const postSessionWrite = httpAction(async (ctx, request) => {
  const authenticated = await authenticatePikaRequest(request);
  if (!authenticated.ok) return authenticated.response;

  const suffix = authenticated.url.pathname.slice(SESSION_PATH_PREFIX.length);
  const [occurrenceRef, operationSegment, extraSegment] = suffix.split("/");
  if (
    !occurrenceRef ||
    (operationSegment !== "commands" &&
      operationSegment !== "marks" &&
      operationSegment !== "check-in" &&
      operationSegment !== "student-check-ins") ||
    extraSegment !== undefined
  ) {
    return jsonResponse(404, { ok: false, error: "not_found" });
  }

  let input: unknown;
  try {
    input = JSON.parse(authenticated.body);
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  const validation = validateV1Message(input);
  const expectedMessageType =
    operationSegment === "commands"
      ? "session.command"
      : operationSegment === "marks"
        ? "attendance.marks"
        : operationSegment === "check-in"
          ? "check_in.presentation"
          : "student_check_in";
  if (!validation.ok || validation.value.message_type !== expectedMessageType) {
    return jsonResponse(422, {
      ok: false,
      error: validation.ok ? "wrong_message_type" : validation.error,
    });
  }
  if (
    validation.value.installation_ref !== authenticated.installationRef ||
    validation.value.occurrence_ref !== occurrenceRef
  ) {
    return jsonResponse(422, { ok: false, error: "resource_mismatch" });
  }

  if (validation.value.message_type === "session.command") {
    const result = await ctx.runMutation(internal.pikaIntegration.applySessionCommand, {
      nonce: authenticated.nonce,
      requestTimestamp: authenticated.timestampSeconds,
      bodyDigest: authenticated.bodyDigest,
      payload: validation.value,
    });
    if (result.ok) return jsonResponse(200, result);

    switch (result.code) {
      case "occurrence_not_found":
        return jsonResponse(404, result);
      case "actor_not_authorized":
        return jsonResponse(403, result);
      case "replayed_request":
      case "idempotency_conflict":
      case "invalid_session_state":
      case "active_session_conflict":
      case "roster_empty":
        return jsonResponse(409, result);
      case "integration_state_invalid":
        return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
    }
  } else if (validation.value.message_type === "attendance.marks") {
    const result = await ctx.runMutation(internal.pikaIntegration.applyAttendanceMarks, {
      nonce: authenticated.nonce,
      requestTimestamp: authenticated.timestampSeconds,
      bodyDigest: authenticated.bodyDigest,
      payload: validation.value,
    });
    if (result.ok) return jsonResponse(200, result);

    switch (result.code) {
      case "occurrence_not_found":
      case "participant_not_found":
        return jsonResponse(404, result);
      case "actor_not_authorized":
        return jsonResponse(403, result);
      case "replayed_request":
      case "idempotency_conflict":
      case "invalid_session_state":
        return jsonResponse(409, result);
      case "integration_state_invalid":
        return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
    }
  } else if (validation.value.message_type === "check_in.presentation") {
    const nonceAccepted = await ctx.runMutation(
      internal.pikaIntegration.consumeSignedRequestNonce,
      {
        installationRef: authenticated.installationRef,
        nonce: authenticated.nonce,
        requestTimestamp: authenticated.timestampSeconds,
      },
    );
    if (!nonceAccepted) {
      return jsonResponse(409, { ok: false, code: "replayed_request" });
    }
    const result = await ctx.runMutation(internal.pikaIntegration.getCheckInPresentation, {
      installationRef: authenticated.installationRef,
      rosterRef: validation.value.roster_ref,
      occurrenceRef: validation.value.occurrence_ref,
      actorPrincipalRef: validation.value.actor_principal_ref,
      actorDisplayName: validation.value.actor_display_name,
      now: Date.now(),
    });
    if (result.ok) return jsonResponse(200, result);

    switch (result.code) {
      case "occurrence_not_found":
        return jsonResponse(404, result);
      case "actor_not_authorized":
        return jsonResponse(403, result);
      case "invalid_session_state":
        return jsonResponse(409, result);
      case "integration_state_invalid":
        return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
    }
  } else if (validation.value.message_type === "student_check_in") {
    const result = await ctx.runMutation(internal.pikaIntegration.applyStudentCheckIn, {
      nonce: authenticated.nonce,
      requestTimestamp: authenticated.timestampSeconds,
      bodyDigest: authenticated.bodyDigest,
      payload: validation.value,
    });
    if (result.ok) return jsonResponse(200, result);

    switch (result.code) {
      case "occurrence_not_found":
        return jsonResponse(404, result);
      case "replayed_request":
      case "idempotency_conflict":
      case "invalid_session_state":
        return jsonResponse(409, result);
      case "integration_state_invalid":
        return jsonResponse(503, { ok: false, error: "temporarily_unavailable" });
    }
  }
  return jsonResponse(500, { ok: false, error: "temporarily_unavailable" });
});

const getSessionSnapshot = httpAction(async (ctx, request) => {
  const authenticated = await authenticatePikaRequest(request);
  if (!authenticated.ok) return authenticated.response;

  const occurrenceRef = authenticated.url.pathname.slice(SESSION_PATH_PREFIX.length);
  if (!occurrenceRef || occurrenceRef.includes("/")) {
    return jsonResponse(404, { ok: false, error: "not_found" });
  }
  const nonceAccepted = await ctx.runMutation(
    internal.pikaIntegration.consumeSignedRequestNonce,
    {
      installationRef: authenticated.installationRef,
      nonce: authenticated.nonce,
      requestTimestamp: authenticated.timestampSeconds,
    },
  );
  if (!nonceAccepted) {
    return jsonResponse(409, { ok: false, code: "replayed_request" });
  }
  const result = await ctx.runQuery(internal.pikaIntegration.getSessionSnapshot, {
    installationRef: authenticated.installationRef,
    occurrenceRef,
  });
  if (!result) return jsonResponse(404, { ok: false, code: "occurrence_not_found" });
  return jsonResponse(200, { ok: true, ...result });
});

const http = httpRouter();
http.route({
  pathPrefix: ROSTER_PATH_PREFIX,
  method: "PUT",
  handler: putRosterSnapshot,
});
http.route({
  pathPrefix: SESSION_PATH_PREFIX,
  method: "POST",
  handler: postSessionWrite,
});
http.route({
  pathPrefix: SESSION_PATH_PREFIX,
  method: "GET",
  handler: getSessionSnapshot,
});
http.route({
  pathPrefix: SCHEDULE_PATH_PREFIX,
  method: "PUT",
  handler: putScheduleSnapshot,
});
http.route({
  path: SMOKE_PATH,
  method: "POST",
  handler: postSmoke,
});

export default http;
