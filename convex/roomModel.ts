import { ConvexError } from "convex/values";
import { createShareToken } from "../lib/session-links";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

import { roomDate } from "../lib/room-date";
export { roomDate, roomWindowEnd } from "../lib/room-date";

export const maxRoomMeetings = 32;

export function normalizeRoomName(name: string) {
  const label = name.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) throw new ConvexError("Enter a room name of up to 80 characters.");
  return { label, labelKey: label.toLowerCase() };
}

export function listStandaloneRooms(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  return ctx.db.query("rooms").withIndex("by_organizationId_installation_archive_labelKey", (q) =>
    q.eq("organizationId", organizationId).eq("pikaInstallationRef", undefined).eq("archivedAt", undefined)).take(200);
}

export function findStandaloneRoomByName(ctx: MutationCtx, organizationId: Id<"organizations">, labelKey: string) {
  return ctx.db.query("rooms").withIndex("by_organizationId_installation_archive_labelKey", (q) =>
    q.eq("organizationId", organizationId).eq("pikaInstallationRef", undefined).eq("archivedAt", undefined).eq("labelKey", labelKey)).unique();
}

export async function findOrCreateStandaloneRoom(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  createdByAppUserId: Id<"app_users">,
  name: string,
  rejectDuplicate = false,
) {
  const { label, labelKey } = normalizeRoomName(name);
  const existing = await findStandaloneRoomByName(ctx, organizationId, labelKey);
  if (existing) {
    if (rejectDuplicate) throw new ConvexError("A room with that name already exists.");
    return existing._id;
  }
  return ctx.db.insert("rooms", {
    organizationId, createdByAppUserId, label, labelKey, qrRevision: createShareToken(), notices: [],
  });
}

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

export function currentWindows(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">, date: string, now: number) {
  return ctx.db.query("sessions").withIndex("by_roomId_and_date_and_status_and_roomCheckInUntil", (q) =>
    q.eq("roomId", roomId).eq("date", date).eq("status", "open").gt("roomCheckInUntil", now),
  ).take(maxRoomMeetings);
}

export async function refreshRoomQr(ctx: MutationCtx, roomId: Id<"rooms"> | undefined) {
  if (roomId && await ctx.db.get(roomId)) {
    await ctx.db.patch(roomId, { qrRevision: createShareToken() });
  }
}
