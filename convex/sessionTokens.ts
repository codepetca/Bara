import type { Doc } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type TokenCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export type SessionTokenTarget =
  | {
      kind: "session";
      session: Doc<"sessions">;
      roster: Doc<"rosters">;
      token: string;
    }
  | {
      kind: "roster";
      session: Doc<"sessions"> | null;
      roster: Doc<"rosters">;
      token: string;
    };

async function loadActiveSessionForRoster(ctx: TokenCtx, rosterId: Doc<"rosters">["_id"]) {
  return await ctx.db
    .query("sessions")
    .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", rosterId).eq("status", "open"))
    .unique();
}

export async function loadSessionTokenTarget(
  ctx: TokenCtx,
  token: string,
): Promise<SessionTokenTarget | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_checkInToken", (q) => q.eq("checkInToken", token))
    .unique();

  if (session) {
    const roster = await ctx.db.get(session.rosterId);
    return roster ? { kind: "session", session, roster, token } : null;
  }

  const roster = await ctx.db
    .query("rosters")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
    .unique();

  if (!roster) {
    return null;
  }

  return {
    kind: "roster",
    session: await loadActiveSessionForRoster(ctx, roster._id),
    roster,
    token,
  };
}
