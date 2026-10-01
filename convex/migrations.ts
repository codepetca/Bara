import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
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
