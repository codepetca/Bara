import { v } from "convex/values";
import { requireAccessibleRoster } from "./auth";
import { mutation } from "./server";

export const linkPikaClassroom = mutation({
  args: {
    rosterId: v.id("rosters"),
    externalClassroomId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);
    const existingLink = await ctx.db
      .query("roster_external_links")
      .withIndex("by_rosterId", (q) => q.eq("rosterId", roster._id))
      .unique();
    const now = Date.now();

    await ctx.db.patch(roster._id, {
      mode: "pika_linked",
      updatedAt: now,
    });

    if (existingLink) {
      await ctx.db.patch(existingLink._id, {
        provider: "pika",
        externalClassroomId: args.externalClassroomId,
        syncStatus: "sync_needed",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("roster_external_links", {
        rosterId: roster._id,
        provider: "pika",
        externalClassroomId: args.externalClassroomId,
        syncStatus: "sync_needed",
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

export const unlinkPikaClassroom = mutation({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);
    const existingLink = await ctx.db
      .query("roster_external_links")
      .withIndex("by_rosterId", (q) => q.eq("rosterId", roster._id))
      .unique();
    const now = Date.now();

    await ctx.db.patch(roster._id, {
      mode: "standalone",
      updatedAt: now,
    });

    if (existingLink) {
      await ctx.db.delete(existingLink._id);
    }

    return null;
  },
});
