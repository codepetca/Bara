import { v } from "convex/values";
import { internal } from "./api";
import { internalMutation } from "./server";

const NONCE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export const cleanup = internalMutation({
  args: {
    now: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletedNonces: v.number(),
    deletedIdempotency: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const batchSize = Math.min(Math.max(Math.floor(args.batchSize ?? 100), 1), 200);
    const [nonces, idempotency] = await Promise.all([
      ctx.db
        .query("pika_request_nonces")
        .withIndex("by_createdAt", (q) => q.lt("createdAt", now - NONCE_RETENTION_MS))
        .take(batchSize),
      ctx.db
        .query("pika_idempotency")
        .withIndex("by_createdAt", (q) => q.lt("createdAt", now - IDEMPOTENCY_RETENTION_MS))
        .take(batchSize),
    ]);
    for (const nonce of nonces) await ctx.db.delete(nonce._id);
    for (const entry of idempotency) await ctx.db.delete(entry._id);

    const continued = nonces.length === batchSize || idempotency.length === batchSize;
    if (continued) {
      await ctx.scheduler.runAfter(0, internal.pikaRetention.cleanup, { now, batchSize });
    }
    return {
      deletedNonces: nonces.length,
      deletedIdempotency: idempotency.length,
      continued,
    };
  },
});
