import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { createUniqueStaffShareToken } from "./attendanceEngine";
import type { DataModel } from "./model";
import { internalQuery } from "./server";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillRosterOwnerAppUserId = migrations.define({
  table: "rosters",
  migrateOne: (_ctx, roster) => {
    if (roster.ownerAppUserId !== undefined) return;
    return { ownerAppUserId: roster.createdByAppUserId };
  },
});

export const runRosterOwnerBackfill = migrations.runner(
  internal.migrations.backfillRosterOwnerAppUserId,
);

export const rosterOwnerBackfillStatus = internalQuery({
  args: {},
  returns: v.object({
    complete: v.boolean(),
    ownerlessRosterId: v.optional(v.id("rosters")),
  }),
  handler: async (ctx) => {
    const ownerless = await ctx.db
      .query("rosters")
      .withIndex("by_ownerAppUserId_createdAt", (q) => q.eq("ownerAppUserId", undefined))
      .first();
    return {
      complete: ownerless === null,
      ownerlessRosterId: ownerless?._id,
    };
  },
});

/**
 * Mints a staff share token for sessions created before the token split.
 *
 * Until this runs, such a session resolves no /s/ route, so its previously
 * shared links stop working -- which is intended. Any token already exposed
 * through a projected QR is invalidated by the split itself; this backfill
 * simply gives staff a fresh link to copy from the roster page.
 */
export const backfillSessionStaffShareToken = migrations.define({
  table: "sessions",
  migrateOne: async (ctx, session) => {
    if (session.staffShareToken !== undefined) return;
    return { staffShareToken: await createUniqueStaffShareToken(ctx) };
  },
});

export const runSessionStaffShareTokenBackfill = migrations.runner(
  internal.migrations.backfillSessionStaffShareToken,
);

/**
 * Read-only production preflight. The migrations component's dry run logs
 * before/after documents, including session tokens, so use this counts-only
 * query to inspect live eligibility instead. Token generation and rollback
 * behavior are exercised with synthetic data in the migration tests.
 *
 * Counts are per page, not a shared snapshot across calls. Keep the opaque
 * cursor private, sum pages until isDone, and verify completion after migration.
 */
export const sessionStaffShareTokenBackfillPreflight = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    pending: v.number(),
    pendingOpen: v.number(),
    pendingClosed: v.number(),
    alreadyBackfilled: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error("Batch size must be an integer from 1 to 100.");
    }
    const { page, isDone, continueCursor } = await ctx.db
      .query("sessions")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    let pendingOpen = 0;
    let pendingClosed = 0;
    for (const session of page) {
      // Match the migration's exact eligibility predicate, including preserving
      // any existing string value rather than silently rotating a credential.
      if (session.staffShareToken !== undefined) continue;
      if (session.status === "open") pendingOpen += 1;
      else pendingClosed += 1;
    }
    const pending = pendingOpen + pendingClosed;
    return {
      scanned: page.length,
      pending,
      pendingOpen,
      pendingClosed,
      alreadyBackfilled: page.length - pending,
      isDone,
      continueCursor,
    };
  },
});

export const sessionStaffShareTokenBackfillStatus = internalQuery({
  args: {},
  returns: v.object({
    complete: v.boolean(),
    pendingSessionId: v.optional(v.id("sessions")),
  }),
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("sessions")
      .withIndex("by_staffShareToken", (q) => q.eq("staffShareToken", undefined))
      .first();
    return {
      complete: pending === null,
      pendingSessionId: pending?._id,
    };
  },
});
