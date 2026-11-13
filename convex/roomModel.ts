import { createShareToken } from "../lib/session-links";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

import { roomDate } from "../lib/room-date";
export { roomDate, roomWindowEnd } from "../lib/room-date";

export async function isStandaloneRoster(ctx: QueryCtx | MutationCtx, rosterId: Id<"rosters">) {
  return !(await ctx.db.query("pika_integrated_rosters")
    .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId)).first());
}

export async function getOpenRosterMeeting(
  ctx: QueryCtx | MutationCtx,
  rosterId: Id<"rosters">,
  date: string,
  skipLegacy = false,
) {
  if (!skipLegacy) {
    const legacy = await ctx.db.query("sessions").withIndex("by_rosterId_and_status_and_roomMode",
      (q) => q.eq("rosterId", rosterId).eq("status", "open").eq("roomMode", undefined)).first();
    if (legacy) return legacy;
  }
  return ctx.db.query("sessions").withIndex("by_rosterId_and_status_and_date",
    (q) => q.eq("rosterId", rosterId).eq("status", "open").eq("date", date)).first();
}

export function meetingAcceptsRoomScan(session: Doc<"sessions">, now: number) {
  return session.roomMode === true && session.status === "open" &&
    session.date === roomDate(now) && (session.roomCheckInUntil ?? 0) > now;
}

export async function refreshRoomQr(ctx: MutationCtx, roomId: Id<"rooms"> | undefined) {
  if (roomId && await ctx.db.get(roomId)) {
    await ctx.db.patch(roomId, { qrRevision: createShareToken() });
  }
}
