import { createShareToken } from "../lib/session-links";
import type { MutationCtx, QueryCtx } from "./server";

type TokenCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

async function tokenExists(ctx: TokenCtx, token: string) {
  const [sessionMatch, rosterMatch] = await Promise.all([
    ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", token))
      .unique(),
    ctx.db
      .query("rosters")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .unique(),
  ]);

  return Boolean(sessionMatch || rosterMatch);
}

export async function createUniqueShareToken(ctx: TokenCtx) {
  let token = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    token = createShareToken();
    if (!(await tokenExists(ctx, token))) {
      return token;
    }
  }

  if (!token || (await tokenExists(ctx, token))) {
    throw new Error("Could not generate share link. Please try again.");
  }

  return token;
}
