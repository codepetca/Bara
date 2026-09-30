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
