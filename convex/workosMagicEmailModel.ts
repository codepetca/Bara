import { v } from "convex/values";
import { internal } from "./api";
import { internalMutation } from "./server";

const LEASE_MS = 60_000;
const BREVO_SEND_LEASE_MS = 30_000;
const EXPIRED_PENDING_RETENTION_MS = 24 * 60 * 60_000;

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
);

const claimedEventValidator = v.object({
  eventId: v.string(),
  magicAuthId: v.string(),
  clientId: v.string(),
  expiresAt: v.number(),
  brevoIdempotencyKey: v.string(),
  brevoFirstAttemptAt: v.optional(v.number()),
  attemptCount: v.number(),
  leaseToken: v.string(),
});

export const enqueue = internalMutation({
  args: {
    eventId: v.string(),
    magicAuthId: v.string(),
    clientId: v.string(),
    expiresAt: v.number(),
    brevoIdempotencyKey: v.string(),
    now: v.number(),
  },
  returns: v.object({
    outcome: v.union(v.literal("created"), v.literal("duplicate"), v.literal("conflict")),
    status: statusValidator,
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workos_magic_email_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) {
      const sameEvent =
        existing.magicAuthId === args.magicAuthId &&
        existing.clientId === args.clientId &&
        existing.expiresAt === args.expiresAt;
      return {
        outcome: sameEvent ? ("duplicate" as const) : ("conflict" as const),
        status: existing.status,
      };
    }

    await ctx.db.insert("workos_magic_email_outbox", {
      eventId: args.eventId,
      magicAuthId: args.magicAuthId,
      clientId: args.clientId,
      expiresAt: args.expiresAt,
      brevoIdempotencyKey: args.brevoIdempotencyKey,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { outcome: "created" as const, status: "pending" as const };
  },
});

export const claim = internalMutation({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(claimedEventValidator),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("workos_magic_email_outbox")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(Math.min(Math.max(args.limit * 3, args.limit), 30));
    const claimable = candidates
      .filter((row) => !row.leaseUntil || row.leaseUntil <= args.now)
      .slice(0, Math.min(Math.max(args.limit, 1), 10));

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
        magicAuthId: row.magicAuthId,
        clientId: row.clientId,
        expiresAt: row.expiresAt,
        brevoIdempotencyKey: row.brevoIdempotencyKey,
        brevoFirstAttemptAt: row.brevoFirstAttemptAt,
        attemptCount,
        leaseToken,
      });
    }
    return claimed;
  },
});

export const markBrevoAttempt = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), now: v.number() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("workos_magic_email_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (
      !row ||
      row.status !== "pending" ||
      row.leaseToken !== args.leaseToken ||
      !row.leaseUntil ||
      row.leaseUntil <= args.now
    ) {
      return null;
    }
    const firstAttemptAt = row.brevoFirstAttemptAt ?? args.now;
    await ctx.db.patch(row._id, {
      brevoFirstAttemptAt: firstAttemptAt,
      leaseUntil: args.now + BREVO_SEND_LEASE_MS,
      updatedAt: args.now,
    });
    return firstAttemptAt;
  },
});

export const complete = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("workos_magic_email_outbox")
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
      .query("workos_magic_email_outbox")
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
      .query("workos_magic_email_outbox")
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

export const cleanup = internalMutation({
  args: {
    now: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const batchSize = Math.min(Math.max(Math.floor(args.batchSize ?? 100), 1), 100);
    const before = now - 30 * 24 * 60 * 60_000;
    const pendingBefore = now - EXPIRED_PENDING_RETENTION_MS;
    const [delivered, failed, expiredPending] = await Promise.all([
      ctx.db
        .query("workos_magic_email_outbox")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "delivered").lt("updatedAt", before),
        )
        .take(batchSize),
      ctx.db
        .query("workos_magic_email_outbox")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "failed").lt("updatedAt", before),
        )
        .take(batchSize),
      ctx.db
        .query("workos_magic_email_outbox")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", "pending").lt("expiresAt", pendingBefore),
        )
        .take(batchSize),
    ]);
    for (const row of [...delivered, ...failed, ...expiredPending]) await ctx.db.delete(row._id);
    const continued =
      delivered.length === batchSize ||
      failed.length === batchSize ||
      expiredPending.length === batchSize;
    if (continued) {
      await ctx.scheduler.runAfter(0, internal.workosMagicEmailModel.cleanup, { now, batchSize });
    }
    return {
      deleted: delivered.length + failed.length + expiredPending.length,
      continued,
    };
  },
});
