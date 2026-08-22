// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const installationRef = "pika_recovery_installation";

function makeTest() {
  return convexTest(schema, modules);
}

function eventPayload(input: { eventId: string; occurrenceRef: string; sessionRevision: number }) {
  return JSON.stringify({
    schema_version: 1,
    event_id: input.eventId,
    idempotency_key: `recovery:${input.eventId}`,
    event_type: "attendance.session.scheduled",
    correlation_ref: `correlation_${input.eventId}`,
    installation_ref: installationRef,
    roster_ref: "roster_recovery",
    occurrence_ref: input.occurrenceRef,
    session_revision: input.sessionRevision,
    occurred_at: "2026-08-22T12:00:00Z",
    metadata: {
      opens_at: "2026-08-22T12:30:00Z",
      closes_at: "2026-08-22T13:30:00Z",
    },
  });
}

async function seedOccurrence(
  t: ReturnType<typeof makeTest>,
  input: { occurrenceRef: string; sessionRevision: number },
) {
  await t.run(async (ctx) => {
    let roster = await ctx.db.query("rosters").first();
    if (!roster) {
      const appUserId = await ctx.db.insert("app_users", {
        displayName: "Recovery Owner",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Recovery Organization",
        slug: "recovery-organization",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const rosterId = await ctx.db.insert("rosters", {
        organizationId,
        ownerAppUserId: appUserId,
        createdByAppUserId: appUserId,
        name: "Recovery roster",
        createdAt: 1,
        updatedAt: 1,
      });
      roster = await ctx.db.get(rosterId);
    }
    if (!roster) throw new Error("Recovery roster setup failed.");
    const occurrenceId = await ctx.db.insert("attendance_occurrences", {
      rosterId: roster._id,
      title: "Recovery occurrence",
      date: "2026-08-22",
      opensAt: Date.parse("2026-08-22T12:30:00Z"),
      closesAt: Date.parse("2026-08-22T13:30:00Z"),
      status: "scheduled",
      sessionRevision: input.sessionRevision,
      createdByAppUserId: roster.createdByAppUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("pika_integrated_occurrences", {
      installationRef,
      rosterRef: "roster_recovery",
      occurrenceRef: input.occurrenceRef,
      occurrenceId,
      sourceRevision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedFailedEvent(
  t: ReturnType<typeof makeTest>,
  input: {
    eventId: string;
    occurrenceRef: string;
    sessionRevision: number;
    errorCode?: string;
    attemptCount?: number;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("pika_outbox", {
      installationRef,
      eventId: input.eventId,
      eventType: "attendance.session.scheduled",
      correlationRef: `correlation_${input.eventId}`,
      payloadJson: eventPayload(input),
      status: "failed",
      attemptCount: input.attemptCount ?? 1,
      nextAttemptAt: 0,
      lastErrorCode: input.errorCode ?? "http_401",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

const recoveryArgs = {
  installationRef,
  requestId: "recovery_request_one",
  operatorRef: "operator_oncall",
  reasonCode: "credentials_repaired",
  limit: 10,
  maxDeliveryAttempts: 5,
  maxRecoveryAttempts: 2,
};

describe("Pika attendance event operator recovery", () => {
  beforeEach(() => {
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.spyOn(Date, "now").mockReturnValue(100);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("requeues only current credential failures and supersedes stale revisions", async () => {
    const t = makeTest();
    await seedOccurrence(t, { occurrenceRef: "occurrence_current", sessionRevision: 1 });
    await seedOccurrence(t, { occurrenceRef: "occurrence_stale", sessionRevision: 2 });
    await seedFailedEvent(t, {
      eventId: "event_current",
      occurrenceRef: "occurrence_current",
      sessionRevision: 1,
    });
    await seedFailedEvent(t, {
      eventId: "event_stale",
      occurrenceRef: "occurrence_stale",
      sessionRevision: 1,
    });

    await expect(t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, recoveryArgs))
      .resolves.toEqual({ inspected: 2, requeued: 1, superseded: 1, ineligible: 0, exhausted: 0 });

    const rows = await t.run(async (ctx) => ctx.db.query("pika_outbox").collect());
    expect(rows.find((row) => row.eventId === "event_current")).toMatchObject({
      status: "pending",
      nextAttemptAt: 100,
      recoveryCount: 1,
      lastRecoveryRequestId: recoveryArgs.requestId,
      lastRecoveryReasonCode: recoveryArgs.reasonCode,
    });
    expect(rows.find((row) => row.eventId === "event_stale")).toMatchObject({
      status: "superseded",
      recoveryCount: 1,
    });
    const audits = await t.run(async (ctx) =>
      ctx.db.query("pika_outbox_recovery_audits").collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      installationRef,
      requestId: recoveryArgs.requestId,
      operatorRef: recoveryArgs.operatorRef,
      eligibleErrorCodes: ["http_401", "http_403"],
      inspected: 2,
      requeued: 1,
      superseded: 1,
    });
  });

  it("is idempotent by installation and recovery request id", async () => {
    const t = makeTest();
    await seedOccurrence(t, { occurrenceRef: "occurrence_current", sessionRevision: 1 });
    await seedFailedEvent(t, {
      eventId: "event_current",
      occurrenceRef: "occurrence_current",
      sessionRevision: 1,
    });

    const first = await t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, recoveryArgs);
    const second = await t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, recoveryArgs);
    expect(second).toEqual(first);
    const audits = await t.run(async (ctx) =>
      ctx.db.query("pika_outbox_recovery_audits").collect(),
    );
    expect(audits).toHaveLength(1);
    expect((await t.run(async (ctx) => ctx.db.query("pika_outbox").first()))?.recoveryCount)
      .toBe(1);
  });

  it("rejects reuse of a request id with different authorized bounds", async () => {
    const t = makeTest();
    await t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, recoveryArgs);
    await expect(t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, {
      ...recoveryArgs,
      limit: recoveryArgs.limit - 1,
    })).rejects.toThrow("Attendance recovery request conflicts with its prior audit.");
  });

  it("leaves ineligible and exhausted failures terminal", async () => {
    const t = makeTest();
    await seedOccurrence(t, { occurrenceRef: "occurrence_current", sessionRevision: 1 });
    await seedFailedEvent(t, {
      eventId: "event_ineligible",
      occurrenceRef: "occurrence_current",
      sessionRevision: 1,
      errorCode: "http_422",
    });
    await seedFailedEvent(t, {
      eventId: "event_exhausted",
      occurrenceRef: "occurrence_current",
      sessionRevision: 1,
      attemptCount: 5,
    });

    await expect(t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, recoveryArgs))
      .resolves.toEqual({ inspected: 2, requeued: 0, superseded: 0, ineligible: 1, exhausted: 1 });
    const rows = await t.run(async (ctx) => ctx.db.query("pika_outbox").collect());
    expect(rows.every((row) => row.status === "failed")).toBe(true);
  });

  it("rejects installation escape and unbounded recovery requests", async () => {
    const t = makeTest();
    await expect(t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, {
      ...recoveryArgs,
      installationRef: "another_installation",
    })).rejects.toThrow("Attendance recovery request is invalid.");
    await expect(t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, {
      ...recoveryArgs,
      limit: 51,
    })).rejects.toThrow("Attendance recovery request is invalid.");
  });
});
