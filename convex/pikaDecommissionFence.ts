import type { Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

export async function isPikaRosterDecommissioned(
  ctx: MutationCtx | QueryCtx, installationRef: string, rosterRef: string,
) {
  return Boolean(await ctx.db.query("pika_decommissions")
    .withIndex("by_installationRef_and_rosterRef", (q) =>
      q.eq("installationRef", installationRef).eq("rosterRef", rosterRef))
    .unique());
}

export async function assertRosterNotDecommissioned(
  ctx: MutationCtx | QueryCtx, rosterId: Id<"rosters">,
) {
  const roster = await ctx.db.get(rosterId);
  if (!roster || roster.pikaDecommissioned) throw new Error("Roster unavailable during permanent deletion.");
}
