import { httpRouter } from "convex/server";
import { validateV1Message } from "../lib/attendance-contract/v1/validate";
import { internal } from "./api";
import { authenticatePikaRequest, jsonResponse } from "./pikaHttp";
import { httpAction } from "./server";

const ROSTER_PATH_PREFIX = "/api/integrations/pika/v1/rosters/";
const SCHEDULE_PATH_PREFIX = "/api/integrations/pika/v1/schedules/";
const SESSION_PATH_PREFIX = "/api/integrations/pika/v1/sessions/";

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

export default http;
