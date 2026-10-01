// @vitest-environment edge-runtime

import { convexTest, type TestConvex } from "convex-test";
import type { FunctionReturnType } from "convex/server";
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
  tokens: Array<{ checkInToken: string; staffShareToken?: string; status?: "open" | "closed" }>,
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

describe("session staff share token counts-only preflight", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is registered as an internal query", async () => {
    const { sessionStaffShareTokenBackfillPreflight } = await import("./migrations");

    expect(sessionStaffShareTokenBackfillPreflight.isInternal).toBe(true);
    expect(sessionStaffShareTokenBackfillPreflight.isQuery).toBe(true);
    expect(sessionStaffShareTokenBackfillPreflight).not.toHaveProperty("isPublic");
    expect(sessionStaffShareTokenBackfillPreflight).not.toHaveProperty("isMutation");
    expect(sessionStaffShareTokenBackfillPreflight).not.toHaveProperty("isAction");
  });

  it("returns only zero counts and pagination metadata for an empty table", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {})).resolves.toEqual({
      scanned: 0,
      pending: 0,
      pendingOpen: 0,
      pendingClosed: 0,
      alreadyBackfilled: 0,
      isDone: true,
      continueCursor: expect.any(String),
    });
  });

  it("counts missing tokens across open and closed sessions and skips all existing strings", async () => {
    const t = convexTest(schema, modules);
    await seedSessions(t, [
      { checkInToken: "preflight-pending-open", status: "open" },
      { checkInToken: "preflight-pending-closed", status: "closed" },
      { checkInToken: "preflight-existing-open", staffShareToken: "synthetic-staff-open", status: "open" },
      { checkInToken: "preflight-existing-closed", staffShareToken: "synthetic-staff-closed", status: "closed" },
      { checkInToken: "preflight-empty-staff", staffShareToken: "", status: "open" },
    ]);

    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
      cursor: null,
    })).resolves.toEqual({
      scanned: 5,
      pending: 2,
      pendingOpen: 1,
      pendingClosed: 1,
      alreadyBackfilled: 3,
      isDone: true,
      continueCursor: expect.any(String),
    });
  });

  it("resumes ascending creation-time pages and produces complete summed counts", async () => {
    const t = convexTest(schema, modules);
    await seedSessions(t, [
      { checkInToken: "page-one-pending-open", status: "open" },
      { checkInToken: "page-one-pending-closed", status: "closed" },
      { checkInToken: "page-two-existing", staffShareToken: "synthetic-page-two-staff", status: "open" },
      { checkInToken: "page-two-pending", status: "closed" },
      { checkInToken: "page-three-existing", staffShareToken: "synthetic-page-three-staff", status: "closed" },
      { checkInToken: "page-three-empty", staffShareToken: "", status: "open" },
      { checkInToken: "page-four-pending", status: "open" },
    ]);
    const expectedPages = [
      { scanned: 2, pending: 2, pendingOpen: 1, pendingClosed: 1, alreadyBackfilled: 0, isDone: false },
      { scanned: 2, pending: 1, pendingOpen: 0, pendingClosed: 1, alreadyBackfilled: 1, isDone: false },
      { scanned: 2, pending: 0, pendingOpen: 0, pendingClosed: 0, alreadyBackfilled: 2, isDone: false },
      { scanned: 1, pending: 1, pendingOpen: 1, pendingClosed: 0, alreadyBackfilled: 0, isDone: true },
    ];
    const totals = { scanned: 0, pending: 0, pendingOpen: 0, pendingClosed: 0, alreadyBackfilled: 0 };
    let cursor: string | null = null;
    for (const expected of expectedPages) {
      const page: FunctionReturnType<typeof internal.migrations.sessionStaffShareTokenBackfillPreflight> = await t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
        cursor,
        batchSize: 2,
      });
      expect(page).toEqual({ ...expected, continueCursor: expect.any(String) });
      expect(page.scanned).toBe(page.pending + page.alreadyBackfilled);
      expect(page.pending).toBe(page.pendingOpen + page.pendingClosed);
      if (!page.isDone) expect(page.continueCursor).not.toBe(cursor);
      cursor = page.continueCursor;
      totals.scanned += page.scanned;
      totals.pending += page.pending;
      totals.pendingOpen += page.pendingOpen;
      totals.pendingClosed += page.pendingClosed;
      totals.alreadyBackfilled += page.alreadyBackfilled;
    }
    expect(totals).toEqual({ scanned: 7, pending: 4, pendingOpen: 2, pendingClosed: 2, alreadyBackfilled: 3 });
  });

  it("defaults to 100 rows and accepts both batch-size boundaries", async () => {
    const t = convexTest(schema, modules);
    await seedSessions(t, Array.from({ length: 101 }, (_, index) => ({
      checkInToken: `bounded-preflight-student-${index}`,
    })));

    const first = await t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {});
    expect(first).toEqual({
      scanned: 100,
      pending: 100,
      pendingOpen: 1,
      pendingClosed: 99,
      alreadyBackfilled: 0,
      isDone: false,
      continueCursor: expect.any(String),
    });
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
      cursor: null,
      batchSize: 100,
    })).resolves.toEqual(first);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
      cursor: first.continueCursor,
      batchSize: 1,
    })).resolves.toEqual({
      scanned: 1,
      pending: 1,
      pendingOpen: 0,
      pendingClosed: 1,
      alreadyBackfilled: 0,
      isDone: true,
      continueCursor: expect.any(String),
    });
  });

  it("does not generate tokens, log records, change data, or schedule work", async () => {
    const t = convexTest(schema, modules);
    await seedSessions(t, [
      { checkInToken: "read-only-pending-open", status: "open" },
      { checkInToken: "read-only-pending-closed", status: "closed" },
      { checkInToken: "read-only-existing", staffShareToken: "synthetic-read-only-staff" },
    ]);
    const snapshot = () => t.run(async (ctx) => ({
      sessions: await ctx.db.query("sessions").collect(),
      rosters: await ctx.db.query("rosters").collect(),
      organizations: await ctx.db.query("organizations").collect(),
      users: await ctx.db.query("app_users").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    const before = await snapshot();
    const generate = vi.spyOn(sessionLinks, "createShareToken");
    const randomValues = vi.spyOn(crypto, "getRandomValues");
    const randomUuid = vi.spyOn(crypto, "randomUUID");
    const logs = (["debug", "log", "info", "warn", "error", "trace", "table"] as const)
      .map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    const first = await t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
      batchSize: 2,
    });
    const last = await t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
      cursor: first.continueCursor,
      batchSize: 2,
    });

    expect(first.pending).toBe(2);
    expect(last).toEqual({
      scanned: 1,
      pending: 0,
      pendingOpen: 0,
      pendingClosed: 0,
      alreadyBackfilled: 1,
      isDone: true,
      continueCursor: expect.any(String),
    });
    expect(generate).not.toHaveBeenCalled();
    expect(randomValues).not.toHaveBeenCalled();
    expect(randomUuid).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    expect(before.scheduled).toEqual([]);
  });

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid batch size %s",
    async (batchSize) => {
      const t = convexTest(schema, modules);

      await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {
        batchSize,
      })).rejects.toThrow();
    },
  );

  it("reports zero pending after the real migration while preserving existing and empty tokens", async () => {
    const t = convexTest(schema, modules);
    const before = await seedSessions(t, [
      { checkInToken: "migrate-preflight-open", status: "open" },
      { checkInToken: "migrate-preflight-closed", status: "closed" },
      { checkInToken: "migrate-preflight-existing", staffShareToken: "synthetic-preserved-staff" },
      { checkInToken: "migrate-preflight-empty", staffShareToken: "" },
    ]);
    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {})).resolves.toEqual({
      scanned: 4,
      pending: 2,
      pendingOpen: 1,
      pendingClosed: 1,
      alreadyBackfilled: 2,
      isDone: true,
      continueCursor: expect.any(String),
    });

    await migrateSessionBatch(t);

    await expect(t.query(internal.migrations.sessionStaffShareTokenBackfillPreflight, {})).resolves.toEqual({
      scanned: 4,
      pending: 0,
      pendingOpen: 0,
      pendingClosed: 0,
      alreadyBackfilled: 4,
      isDone: true,
      continueCursor: expect.any(String),
    });
    const after = await t.run(async (ctx) => Promise.all(before.map((session) => ctx.db.get(session._id))));
    expect(after[2]).toEqual(before[2]);
    expect(after[3]).toEqual(before[3]);
    expect(after.map((session) => session?.checkInToken)).toEqual(before.map((session) => session.checkInToken));
  });
});
