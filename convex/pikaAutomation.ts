import { v } from "convex/values";
import { internal } from "./api";
import { internalAction } from "./server";

export const processDueOccurrences = internalAction({
  args: { now: v.optional(v.number()) },
  returns: v.object({
    queuedOpen: v.number(),
    queuedClose: v.number(),
    hasMoreOpen: v.boolean(),
    hasMoreClose: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const openPage = await ctx.runMutation(
      internal.pikaIntegration.processDueOccurrencePage,
      { now, phase: "open", cursor: null },
    );
    const closePage = await ctx.runMutation(
      internal.pikaIntegration.processDueOccurrencePage,
      { now, phase: "close", cursor: null },
    );
    return {
      queuedOpen: openPage.queued,
      queuedClose: closePage.queued,
      hasMoreOpen: openPage.hasMore,
      hasMoreClose: closePage.hasMore,
    };
  },
});
