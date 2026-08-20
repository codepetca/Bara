import { v } from "convex/values";
import { internalMutation } from "./server";

const LEASE_MS = 60_000;

const claimedEventValidator = v.object({
  eventId: v.string(),
  payloadJson: v.string(),
  attemptCount: v.number(),
  leaseToken: v.string(),
});

export const claim = internalMutation({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(claimedEventValidator),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("pika_outbox")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(Math.min(Math.max(args.limit * 3, args.limit), 60));
    const claimable = candidates
      .filter((row) => !row.leaseUntil || row.leaseUntil <= args.now)
      .slice(0, Math.min(Math.max(args.limit, 1), 20));

    const claimed = [];
    for (const row of claimable) {
      const leaseToken = `lease_${args.now}_${row.eventId}`;
      const attemptCount = row.attemptCount + 1;
      await ctx.db.patch(row._id, {
        leaseUntil: args.now + LEASE_MS,
        leaseToken,
        attemptCount,
        updatedAt: args.now,
      });
      claimed.push({
        eventId: row.eventId,
        payloadJson: row.payloadJson,
        attemptCount,
        leaseToken,
      });
    }
    return claimed;
  },
});

export const complete = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    await ctx.db.patch(row._id, {
      status: "delivered",
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: undefined,
      updatedAt: args.now,
    });
    return true;
  },
});

export const retry = internalMutation({
  args: {
    eventId: v.string(),
    leaseToken: v.string(),
    errorCode: v.string(),
    nextAttemptAt: v.number(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    await ctx.db.patch(row._id, {
      nextAttemptAt: args.nextAttemptAt,
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: args.errorCode,
      updatedAt: args.now,
    });
    return true;
  },
});

export const fail = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), errorCode: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    await ctx.db.patch(row._id, {
      status: "failed",
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: args.errorCode,
      updatedAt: args.now,
    });
    return true;
  },
});
