// @vitest-environment edge-runtime

import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessionLinks from "../lib/session-links";
import { internal } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function seedSessions(
  t: TestConvex<typeof schema>,
  tokens: Array<{ checkInToken: string; staffShareToken?: string }>,
) {
  return t.run(async (ctx) => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    const ownerId = await ctx.db.insert("app_users", {
      displayName: "Migration owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Migration organization",
      slug: "migration-organization",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const rosterId = await ctx.db.insert("rosters", {
      organizationId,
      createdByAppUserId: ownerId,
      ownerAppUserId: ownerId,
      name: "Migration roster",
      createdAt: now,
      updatedAt: now,
    });
    const sessions = [];
    for (const [index, tokenPair] of tokens.entries()) {
      const sessionId = await ctx.db.insert("sessions", {
        rosterId,
        createdByAppUserId: ownerId,
        title: `Session ${index + 1}`,
        date: "2026-09-01",
        sessionType: "recurring_class",
        participantMode: "verified",
        status: index === 0 ? "open" : "closed",
        createdAt: now + index,
        updatedAt: now + index,
        ...tokenPair,
      });
      const session = await ctx.db.get(sessionId);
      if (!session) throw new Error("Session fixture was not created.");
      sessions.push(session);
    }
    return sessions;
  });
}

function migrateSessionBatch(t: TestConvex<typeof schema>, cursor: string | null = null, batchSize = 100) {
  return t.mutation(internal.migrations.backfillSessionStaffShareToken, {
    cursor,
    batchSize,
    dryRun: false,
    oneBatchOnly: true,
  });
}

describe("roster ownership migration", () => {
  it("backfills a legacy roster and exposes a clean completion check", async () => {
    const t = convexTest(schema, modules);
    const { rosterId, ownerId } = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("app_users", {
        displayName: "Legacy owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Legacy organization",
        slug: "legacy-organization",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const rosterId = await ctx.db.insert("rosters", {
        organizationId,
        createdByAppUserId: ownerId,
        name: "Legacy roster",
        createdAt: now,
        updatedAt: now,
      });
      return { rosterId, ownerId };
    });

    await expect(t.query(internal.migrations.rosterOwnerBackfillStatus, {})).resolves.toEqual({
      complete: false,
      ownerlessRosterId: rosterId,
    });

    await t.mutation(internal.migrations.backfillRosterOwnerAppUserId, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    await t.run(async (ctx) => {
      expect((await ctx.db.get(rosterId))?.ownerAppUserId).toBe(ownerId);
    });
    await expect(t.query(internal.migrations.rosterOwnerBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
  });
});

describe("session staff share token migration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives open and closed legacy sessions unique staff tokens without changing their student links", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [
      { checkInToken: "legacy-student-one" },
      { checkInToken: "legacy-student-two" },
      { checkInToken: "legacy-student-three" },
    ]);

    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toMatchObject({
      complete: false,
      pendingSessionId: expect.any(String),
    });

    await migrateSessionBatch(t);

    const after = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    const studentTokens = new Set(before.map((session) => session.checkInToken));
    const staffTokens = new Set(after.map((session) => session?.staffShareToken));
    expect(staffTokens.size).toBe(before.length);
    for (const [index, session] of after.entries()) {
      expect(session).toEqual({ ...before[index], staffShareToken: expect.any(String) });
      expect(session?.staffShareToken).toHaveLength(28);
      expect(studentTokens.has(session!.staffShareToken!)).toBe(false);
    }
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
  });

  it("preserves existing staff links and is idempotent when restarted from the beginning", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [
      { checkInToken: "already-migrated-student", staffShareToken: "already-migrated-staff" },
      { checkInToken: "still-legacy-student" },
    ]);

    await migrateSessionBatch(t);
    const once = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    expect(once[0]).toEqual(before[0]);
    expect(once[1]?.staffShareToken).toEqual(expect.any(String));

    await migrateSessionBatch(t);
    const twice = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    expect(twice).toEqual(once);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
  });

  it("retries student, existing staff, and same-batch staff token collisions", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [
      { checkInToken: "legacy-student-one" },
      { checkInToken: "legacy-student-two" },
      { checkInToken: "existing-student", staffShareToken: "existing-staff" },
    ]);
    const generate = vi.spyOn(sessionLinks, "createShareToken")
      .mockReturnValueOnce("legacy-student-one")
      .mockReturnValueOnce("legacy-student-two")
      .mockReturnValueOnce("existing-staff")
      .mockReturnValueOnce("fresh-staff-one")
      .mockReturnValueOnce("fresh-staff-one")
      .mockReturnValueOnce("fresh-staff-two");

    await migrateSessionBatch(t);

    const after = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    expect(new Set(after.map((session) => session?.staffShareToken))).toEqual(new Set([
      "fresh-staff-one", "fresh-staff-two", "existing-staff",
    ]));
    expect(after.map((session) => session?.checkInToken)).toEqual(before.map((session) => session.checkInToken));
    expect(after[2]).toEqual(before[2]);
    expect(generate).toHaveBeenCalledTimes(6);
  });

  it("keeps completion false between bounded batches and resumes from the returned cursor", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [
      { checkInToken: "batch-student-one" },
      { checkInToken: "batch-student-two" },
      { checkInToken: "batch-student-three" },
    ]);

    const firstBatch = await migrateSessionBatch(t, null, 2);
    expect(firstBatch).toMatchObject({ processed: 2, isDone: false });
    expect(firstBatch.continueCursor).toEqual(expect.any(String));
    const afterFirstBatch = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    expect(afterFirstBatch.filter((session) => session?.staffShareToken !== undefined)).toHaveLength(2);
    const pending = afterFirstBatch.find((session) => session?.staffShareToken === undefined);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: false,
      pendingSessionId: pending?._id,
    });

    const finalBatch = await migrateSessionBatch(t, firstBatch.continueCursor, 2);
    expect(finalBatch).toMatchObject({ processed: 1, isDone: true });
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
    await t.run(async (ctx) => {
      for (const session of afterFirstBatch) {
        if (session?.staffShareToken !== undefined) {
          expect(await ctx.db.get(session._id)).toEqual(session);
        }
      }
    });
  });

  it("rolls back a dry run and leaves the completion check pending", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [{ checkInToken: "dry-run-student" }]);
    vi.spyOn(console, "debug").mockImplementation(() => {});

    await expect(t.mutation(internal.migrations.backfillSessionStaffShareToken, {
      cursor: null,
      dryRun: true,
      oneBatchOnly: true,
    })).rejects.toThrow('"kind":"DRY RUN"');

    await t.run(async (ctx) => {
      expect(await ctx.db.get(before[0]._id)).toEqual(before[0]);
    });
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: false,
      pendingSessionId: before[0]._id,
    });

    await migrateSessionBatch(t);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
  });

  it("reports completion for an empty session table", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
    await expect(migrateSessionBatch(t)).resolves.toMatchObject({ processed: 0, isDone: true });
  });
});
