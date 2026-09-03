// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./api";
import schema from "./schema";
import { DECOMMISSION_PATH, type DecommissionRequest } from "../lib/attendance-contract/decommission";
import { createV1RequestSignature } from "../lib/attendance-contract/v1/signing";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const makeTest = () => convexTest(schema, modules);
const secret = "synthetic-only-decommission-signing-secret-123456";
const request: DecommissionRequest = {
  schema_version: 1, message_type: "roster.decommission", action: "begin",
  installation_ref: "installation_one", roster_ref: "roster_one",
  operation_ref: "decommission_0123456789abcdef0123456789abcdef",
  actor_principal_ref: "principal_owner",
};
function roster(rosterRef = "roster_one") {
  return {
    schema_version: 1 as const, message_type: "roster.snapshot" as const,
    idempotency_key: `roster:${rosterRef}`, correlation_ref: "correlation_one",
    installation_ref: request.installation_ref, roster_ref: rosterRef,
    tenant_ref: "tenant_one", revision: 1, owner_principal_ref: request.actor_principal_ref,
    owner_display_name: "Synthetic teacher", display_name: "Synthetic class",
    participants: [{ participant_ref: "participant_one", display_name: "Synthetic student",
      active: true, principal_ref: "principal_student" }],
  };
}
async function seed(t: ReturnType<typeof makeTest>, ref = "roster_one") {
  const result = await t.mutation(internal.pikaIntegration.applyRosterSnapshot, {
    nonce: `nonce_${crypto.randomUUID()}`, requestTimestamp: Date.now() / 1000,
    bodyDigest: "digest", payload: roster(ref),
  });
  expect(result.ok).toBe(true);
  return t.run(async (ctx) => (await ctx.db.query("pika_integrated_rosters")
    .withIndex("by_installationRef_and_rosterRef", q =>
      q.eq("installationRef", request.installation_ref).eq("rosterRef", ref)).unique())!);
}
async function send(t: ReturnType<typeof makeTest>, payload = request, nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({ secret, method: "POST", path: DECOMMISSION_PATH, timestamp, nonce, body });
  return t.fetch(DECOMMISSION_PATH, { method: "POST", body, headers: {
    "Content-Type": "application/json", "X-Attendance-Installation-Ref": request.installation_ref,
    "X-Attendance-Timestamp": timestamp, "X-Attendance-Nonce": nonce, "X-Attendance-Signature": signature,
  } });
}
beforeEach(() => {
  vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
  vi.stubEnv("PIKA_INTEGRATION_REF", request.installation_ref);
  vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  vi.stubEnv("PIKA_DECOMMISSION_MODE", "canary");
  vi.stubEnv("PIKA_DECOMMISSION_CANARY_ROSTER_REF", request.roster_ref);
});
afterEach(() => vi.unstubAllEnvs());

describe("Pika roster decommission", () => {
  it("is disabled by default and rejects non-owners, mismatched scope, and nonce replay", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    vi.stubEnv("PIKA_DECOMMISSION_MODE", "disabled");
    expect((await send(t)).status).toBe(503);
    vi.stubEnv("PIKA_DECOMMISSION_MODE", "canary");
    expect((await send(t, { ...request, actor_principal_ref: "principal_student" })).status).toBe(403);
    expect((await send(t, { ...request, installation_ref: "other" })).status).toBe(422);
    const nonce = "nonce_0123456789abcdef0123456789";
    expect((await send(t, request, nonce)).status).toBe(200);
    expect((await send(t, request, nonce)).status).toBe(409);
    expect((await send(t, { ...request, operation_ref: "decommission_ffffffffffffffffffffffffffffffff" })).status).toBe(409);
  });

  it("fences cached successes, native writes, tokens, and automation before erasure", async () => {
    const t = convexTest(schema, modules);
    const mapping = await seed(t);
    const sessionId = await t.run(ctx => ctx.db.insert("sessions", {
      rosterId: mapping.rosterId, title: "Synthetic", date: "2026-09-03",
      sessionType: "recurring_class", participantMode: "verified", status: "open",
      createdByAppUserId: mapping.ownerAppUserId, checkInToken: "synthetic_token_123456789",
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    expect((await send(t)).status).toBe(200);
    const replay = await t.mutation(internal.pikaIntegration.applyRosterSnapshot, {
      payload: roster(), bodyDigest: "digest", nonce: "new_nonce", requestTimestamp: Date.now() / 1000,
    });
    expect(replay.ok).toBe(false);
    expect(await t.query(api.sessions.getCheckInContext, { token: "synthetic_token_123456789" })).toBeNull();
    expect(await t.query(api.sessions.getDisplayContextByToken, { token: "synthetic_token_123456789" })).toBeNull();
    expect(await t.query(api.attendance.getLiveSessionRowsByToken, { token: "synthetic_token_123456789" })).toBeNull();
    const participant = await t.run(async ctx => (await ctx.db.query("participants").first())!);
    await expect(t.mutation(api.attendance.markManualByToken, {
      token: "synthetic_token_123456789", participantId: participant._id, nextStatus: "present",
    })).rejects.toThrow("permanent deletion");
    vi.stubEnv("PIKA_DECOMMISSION_MODE", "disabled");
    expect((await send(t, { ...request, action: "tick" })).status).toBe(503);
    expect(await t.run(async ctx => (await ctx.db.get(mapping.rosterId))?.pikaDecommissioned)).toBe(true);
    expect(await t.run(ctx => ctx.db.get(sessionId))).not.toBeNull();
  });

  it("deletes in bounded resumable batches, preserves shared identities, and never recreates the roster", async () => {
    const t = convexTest(schema, modules);
    const mapping = await seed(t);
    const other = await seed(t, "roster_other");
    const before = await t.run(async ctx => ({
      users: await ctx.db.query("app_users").collect(), identities: await ctx.db.query("auth_identities").collect(),
    }));
    await t.run(async ctx => {
      const participant = (await ctx.db.query("participants")
        .withIndex("by_rosterId_sortKey", q => q.eq("rosterId", mapping.rosterId)).first())!;
      const sessionId = await ctx.db.insert("sessions", { rosterId: mapping.rosterId,
        title: "Synthetic", date: "2026-09-03", sessionType: "recurring_class", participantMode: "verified",
        status: "open", createdByAppUserId: mapping.ownerAppUserId, checkInToken: "synthetic_history_token",
        createdAt: Date.now(), updatedAt: Date.now() });
      const occurrenceId = await ctx.db.insert("attendance_occurrences", { rosterId: mapping.rosterId,
        title: "Synthetic", date: "2026-09-03", opensAt: Date.now() - 1000, closesAt: Date.now() + 1000,
        status: "open", sessionId, sessionRevision: 2, createdByAppUserId: mapping.ownerAppUserId,
        createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("pika_integrated_occurrences", { installationRef: request.installation_ref,
        rosterRef: request.roster_ref, occurrenceRef: "occurrence_one", occurrenceId, sourceRevision: 1,
        createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("pika_check_ins", { installationRef: request.installation_ref, rosterRef: request.roster_ref,
        occurrenceRef: "occurrence_one", occurrenceId, participantRef: "participant_one", participantId: participant._id,
        checkInRef: "check_in_one", checkInRevision: 1, acceptedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("attendance_records", { sessionId, participantId: participant._id, status: "present", modifiedAt: Date.now() });
      await ctx.db.insert("attendance_events", { sessionId, participantId: participant._id, actorType: "student",
        eventType: "student_check_in", result: "applied", createdAt: Date.now() });
      await ctx.db.insert("pika_schedule_windows", { installationRef: request.installation_ref, rosterRef: request.roster_ref,
        sourceRevision: 1, timezone: "America/Toronto", windowStart: "2026-09-01", windowEnd: "2026-09-30",
        createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("pika_idempotency", { installationRef: request.installation_ref,
        idempotencyKey: "cached_student_scan", correlationRef: "old", messageType: "student_check_in", bodyDigest: "old",
        resourceRef: "occurrence_one", sourceRevision: 1, createdCount: 1, updatedCount: 0, deactivatedCount: 0,
        resultJson: JSON.stringify({ check_in_ref: "check_in_one" }), createdAt: Date.now() });
      for (const state of ["pending", "delivered", "failed", "superseded"] as const) {
        const eventId = `event_${state}`;
        const event = { schema_version: 1, event_id: eventId, idempotency_key: `event:${state}`,
          correlation_ref: "correlation_one", event_type: "attendance.check_in.accepted",
          installation_ref: request.installation_ref, roster_ref: request.roster_ref, occurrence_ref: "occurrence_one",
          session_revision: 2, occurred_at: new Date().toISOString(), metadata: { check_in_ref: "check_in_one",
            participant_ref: "participant_one", check_in_revision: 1, accepted_at: new Date().toISOString() } };
        await ctx.db.insert("pika_outbox", { installationRef: request.installation_ref, eventId,
          eventType: "attendance.check_in.accepted", correlationRef: "correlation_one", payloadJson: JSON.stringify(event),
          status: state, attemptCount: 1, nextAttemptAt: 0, leaseToken: "old_lease", leaseUntil: Date.now() + 60000,
          createdAt: Date.now(), updatedAt: Date.now() });
      }
      for (let i = 0; i < 125; i++) await ctx.db.insert("pika_idempotency", {
        installationRef: request.installation_ref, idempotencyKey: `old_${i}`, correlationRef: "old",
        messageType: "roster.snapshot", bodyDigest: "old", resourceRef: request.roster_ref,
        sourceRevision: i, createdCount: 1, updatedCount: 0, deactivatedCount: 0, createdAt: Date.now(),
      });
    });
    const begin = await (await send(t)).json();
    expect(begin).toMatchObject({ state: "deleting", absence_verified: false, deleted_count: 0 });
    expect(await t.mutation(internal.pikaOutboxModel.claim, { now: Date.now() + 60001, limit: 10 })).toEqual([]);
    const occurrence = await t.run(async ctx => (await ctx.db.query("attendance_occurrences").first())!);
    expect(await t.mutation(internal.pikaIntegration.processOccurrenceAutomation,
      { occurrenceId: occurrence._id, now: Date.now() + 60001 })).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 0 });
    let result = begin;
    let ticks = 0;
    while (result.state !== "deleted" && ticks++ < 100) {
      const response = await send(t, { ...request, action: "tick" });
      expect(response.status).toBe(200);
      const next = await response.json();
      expect(next.deleted_count - result.deleted_count).toBeLessThanOrEqual(50);
      result = next;
    }
    expect(ticks).toBeGreaterThan(2);
    expect(result).toMatchObject({ state: "deleted", absence_verified: true });
    expect(await (await send(t)).json()).toEqual(result);
    const after = await t.run(async ctx => ({
      users: await ctx.db.query("app_users").collect(), identities: await ctx.db.query("auth_identities").collect(),
      roster: await ctx.db.get(mapping.rosterId), other: await ctx.db.get(other.rosterId),
      maps: await ctx.db.query("pika_integrated_rosters").collect(),
      participants: await ctx.db.query("participants").collect(),
      cached: await ctx.db.query("pika_idempotency").collect(),
      tombstone: await ctx.db.query("pika_decommissions").unique(),
    }));
    expect(after.users).toEqual(before.users);
    expect(after.identities).toEqual(before.identities);
    expect(after.roster).toBeNull();
    expect(after.other).not.toBeNull();
    expect(after.maps).toHaveLength(1);
    expect(after.participants).toHaveLength(1);
    expect(after.cached).toHaveLength(1);
    expect(after.tombstone?.rosterId).toBeUndefined();
    await t.run(async ctx => {
      for (const table of ["sessions", "attendance_records", "attendance_events", "attendance_occurrences",
        "pika_integrated_occurrences", "pika_check_ins", "pika_schedule_windows", "pika_outbox"] as const) {
        expect(await ctx.db.query(table).collect(), table).toEqual([]);
      }
    });
    expect(await t.mutation(internal.pikaOutboxModel.retry, { eventId: "event_pending", leaseToken: "old_lease",
      errorCode: "late_delivery_failed", nextAttemptAt: Date.now(), now: Date.now() })).toBe(false);
    const replay = await t.mutation(internal.pikaIntegration.applyRosterSnapshot, {
      payload: { ...roster(), revision: 999, idempotency_key: "new_after_delete" },
      bodyDigest: "new", nonce: "after_delete_nonce", requestTimestamp: Date.now() / 1000,
    });
    expect(replay.ok).toBe(false);
  });

  it("keeps the fence and reports no success when legacy scope cannot be verified", async () => {
    const t = makeTest();
    const mapping = await seed(t);
    await t.run(ctx => ctx.db.insert("pika_outbox", { installationRef: request.installation_ref,
      eventId: "broken", eventType: "attendance.session.closed", correlationRef: "unknown",
      payloadJson: "{}", status: "failed", attemptCount: 0, nextAttemptAt: 0, createdAt: 1, updatedAt: 1 }));
    expect((await send(t)).status).toBe(200);
    expect((await send(t, { ...request, action: "tick" })).status).toBe(503);
    expect(await (await send(t, { ...request, action: "status" })).json())
      .toMatchObject({ state: "deleting", absence_verified: false, deleted_count: 0 });
    expect(await t.run(async ctx => (await ctx.db.get(mapping.rosterId))?.pikaDecommissioned)).toBe(true);
  });
});
