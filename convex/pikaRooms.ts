import { v } from "convex/values";
import { createShareToken } from "../lib/session-links";
import { nextRoomDay } from "../lib/room-date";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import { internal } from "./api";
import { createUniqueCheckInToken } from "./attendanceEngine";
import type { Doc, Id } from "./model";
import { isPikaRosterDecommissioned } from "./pikaDecommissionFence";
import { ensurePikaStaffAccess } from "./pikaStaffAccess";
import { meetingAcceptsRoomScan, refreshRoomQr, roomDate } from "./roomModel";
import { captureRoomScan, capturedRoomSession, currentWindows, findScan, maxRoomMeetings, transferMeeting } from "./rooms";
import { internalMutation, type MutationCtx } from "./server";

const scanArgs = { room_id: v.string(), browser_key: v.string() };
const staffArgs = { roster_ref: v.string(), actor_principal_ref: v.string(), actor_display_name: v.string() };
const roomArgs = { room_id: v.string() };
const meetingArgs = { occurrence_ref: v.string() };

const command = v.union(
  v.object({ operation: v.literal("capture"), ...scanArgs, proof: v.string() }),
  v.object({ operation: v.literal("candidates"), ...scanArgs, continuation: v.string() }),
  v.object({ operation: v.literal("list"), ...staffArgs, occurrence_ref: v.optional(v.string()) }),
  v.object({ operation: v.literal("create"), ...staffArgs, label: v.string() }),
  v.object({ operation: v.literal("pair"), ...staffArgs, ...roomArgs }),
  v.object({ operation: v.literal("revoke"), ...staffArgs, ...roomArgs }),
  v.object({ operation: v.literal("default"), ...staffArgs, room_id: v.union(v.string(), v.null()) }),
  v.object({ operation: v.literal("move"), ...staffArgs, ...roomArgs, ...meetingArgs, save_default: v.optional(v.boolean()) }),
  v.object({ operation: v.literal("undo"), ...staffArgs, ...meetingArgs, revision: v.number() }),
  v.object({ operation: v.literal("notices"), ...staffArgs, ...roomArgs, notices: v.array(v.string()) }),
);
const ok = { ok: true as const };
const invalid = { ok: false as const, code: "invalid_room_request" };
const unavailable = { ok: false as const, code: "room_unavailable" };
const conflict = { ok: false as const, code: "room_conflict" };
const unpaired = { ok: false as const, code: "room_unpaired" };
const denied = { ok: false as const, code: "actor_not_authorized" };
const opaqueRef = /^[A-Za-z0-9._~-]{1,128}$/;

const refsValidator = v.object({ roster_ref: v.string(), occurrence_ref: v.string() });
const resultValidator = v.union(
  v.object({ ok: v.literal(false), code: v.string() }),
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(true), continuation: v.union(v.string(), v.null()) }),
  v.object({ ok: v.literal(true), candidates: v.union(v.array(refsValidator), v.null()) }),
  v.object({ ok: v.literal(true), room_id: v.id("rooms") }),
  v.object({ ok: v.literal(true), credential: v.string() }),
  v.object({ ok: v.literal(true), revision: v.number() }),
  v.object({
    ok: v.literal(true),
    rooms: v.array(v.object({ room_id: v.id("rooms"), label: v.string(), can_manage: v.boolean(), paired: v.boolean() })),
    default_room_id: v.union(v.id("rooms"), v.null()),
    meeting: v.union(v.object({
      room_id: v.union(v.id("rooms"), v.null()),
      revision: v.number(),
      accepting_until: v.union(v.number(), v.null()),
    }), v.null()),
  }),
);

async function pikaRoom(ctx: MutationCtx, roomId: Id<"rooms">, installationRef: string) {
  const room = await ctx.db.get(roomId);
  return room?.pikaInstallationRef === installationRef &&
    (await ctx.db.get(room.organizationId))?.status === "active" ? room : null;
}

export async function getPikaRoomScan(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  installationRef: string,
  token: string,
  principalRef: string,
  now: number,
) {
  const match = /^room_([A-Za-z0-9_-]{40})\.([A-Za-z0-9_-]{32,80})$/.exec(token);
  if (!match || !session.roomId) return null;
  const room = await pikaRoom(ctx, session.roomId, installationRef);
  if (!room?.displayKeyHash) return null;
  const scan = await findScan(ctx, room, match[1], match[2], now);
  if (!scan || (scan.pikaPrincipalRef && scan.pikaPrincipalRef !== principalRef)) return null;
  const window = scan.windows.find(({ sessionId }) => sessionId === session._id);
  return window && await capturedRoomSession(ctx, room._id, window, now) ? scan : null;
}

export async function pairedPikaDefault(ctx: MutationCtx, roster: Doc<"rosters">) {
  const room = roster.defaultRoomId && await ctx.db.get(roster.defaultRoomId);
  return Boolean(room && room.organizationId === roster.organizationId && room.pikaInstallationRef && room.displayKeyHash);
}

export async function openPikaRoomWindow(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  occurrence: Doc<"attendance_occurrences">,
  now: number,
) {
  if (session.date !== roomDate(now) || !session.roomId) return;
  const cutoff = Math.min(occurrence.closesAt, nextRoomDay(now));
  if (cutoff <= now) return;
  // Reopening an already active window keeps its cutoff and QR proof.
  if (meetingAcceptsRoomScan(session, now)) return;
  if ((await currentWindows(ctx, session.roomId, session.date, now)).length >= maxRoomMeetings) {
    // Keep the meeting available through its normal classroom QR if the room is full.
    await ctx.db.patch(session._id, { roomMode: undefined, roomId: undefined });
    return;
  }
  await ctx.db.patch(session._id, {
    roomCheckInUntil: cutoff, roomWindowRevision: (session.roomWindowRevision ?? 0) + 1,
  });
  await ctx.scheduler.runAt(cutoff, internal.rooms.expireWindow, { sessionId: session._id, cutoff });
  await refreshRoomQr(ctx, session.roomId);
}

async function scanCandidates(
  ctx: MutationCtx,
  installationRef: string,
  room: Doc<"rooms">,
  continuation: string,
  browserKey: string,
  now: number,
) {
  const scan = await findScan(ctx, room, continuation, browserKey, now);
  if (!scan) return null;
  const candidates = await Promise.all(scan.windows.map(async (window) => {
    const session = await capturedRoomSession(ctx, room._id, window, now);
    if (!session) return null;
    const occurrence = await ctx.db.query("attendance_occurrences").withIndex("by_sessionId", q =>
      q.eq("sessionId", session._id)).unique();
    if (!occurrence || occurrence.status !== "open" || occurrence.closesAt <= now) return null;
    const mapping = await ctx.db.query("pika_integrated_occurrences").withIndex("by_occurrenceId", q =>
      q.eq("occurrenceId", occurrence._id)).unique();
    if (mapping?.installationRef !== installationRef ||
      await isPikaRosterDecommissioned(ctx, installationRef, mapping.rosterRef)) return null;
    return { roster_ref: mapping.rosterRef, occurrence_ref: mapping.occurrenceRef };
  }));
  return candidates.filter(candidate => candidate !== null);
}

async function findMeeting(ctx: MutationCtx, installationRef: string, rosterRef: string, occurrenceRef: string, now: number) {
  const mapping = await ctx.db.query("pika_integrated_occurrences")
    .withIndex("by_installationRef_rosterRef_occurrenceRef", q =>
      q.eq("installationRef", installationRef).eq("rosterRef", rosterRef).eq("occurrenceRef", occurrenceRef)).unique();
  const occurrence = mapping && await ctx.db.get(mapping.occurrenceId);
  if (!occurrence?.sessionId || occurrence.date !== roomDate(now) ||
    occurrence.status !== "open" || occurrence.closesAt <= now) return null;
  const session = await ctx.db.get(occurrence.sessionId);
  return session?.status === "open" && session.rosterId === occurrence.rosterId ? { occurrence, session } : null;
}

export const apply = internalMutation({
  args: { installationRef: v.string(), payload: command },
  returns: resultValidator,
  handler: async (ctx, { installationRef, payload }) => {
    const now = Date.now();
    if (payload.operation === "capture" || payload.operation === "candidates") {
      const roomId = ctx.db.normalizeId("rooms", payload.room_id);
      if (payload.operation === "capture") return {
        ...ok,
        continuation: roomId ? await captureRoomScan(ctx, {
          roomId, proof: payload.proof, browserKey: payload.browser_key,
        }, installationRef) : null,
      };
      const room = roomId && await pikaRoom(ctx, roomId, installationRef);
      return {
        ...ok,
        candidates: room?.displayKeyHash
          ? await scanCandidates(ctx, installationRef, room, payload.continuation, payload.browser_key, now) : null,
      };
    }

    if (!opaqueRef.test(payload.roster_ref) || !opaqueRef.test(payload.actor_principal_ref) ||
      !payload.actor_display_name.trim() || payload.actor_display_name.length > 200 ||
      ("occurrence_ref" in payload && payload.occurrence_ref !== undefined && !opaqueRef.test(payload.occurrence_ref))) return invalid;
    if (await isPikaRosterDecommissioned(ctx, installationRef, payload.roster_ref)) return unavailable;
    const actor = await ensurePikaStaffAccess(ctx, {
      installationRef, rosterRef: payload.roster_ref, principalRef: payload.actor_principal_ref,
      displayName: payload.actor_display_name, now,
    });
    if (!actor.ok) return denied;
    const { roster } = actor;
    const canManage = (room: Doc<"rooms">) => room.createdByAppUserId === actor.appUser._id || actor.access.accessRole === "admin";
    const roomId = "room_id" in payload && payload.room_id ? ctx.db.normalizeId("rooms", payload.room_id) : null;
    const room = roomId && await pikaRoom(ctx, roomId, installationRef);
    if ("room_id" in payload && payload.room_id !== null && (!room || room.organizationId !== roster.organizationId)) return unavailable;

    const rooms = () => ctx.db.query("rooms").withIndex("by_organizationId_installation_labelKey", q =>
      q.eq("organizationId", roster.organizationId).eq("pikaInstallationRef", installationRef));
    const meeting = "occurrence_ref" in payload && payload.occurrence_ref
      ? await findMeeting(ctx, installationRef, payload.roster_ref, payload.occurrence_ref, now) : null;

    switch (payload.operation) {
      case "list":
        return {
          ...ok,
          rooms: (await rooms().take(200)).map(entry => ({ room_id: entry._id, label: entry.label, can_manage: canManage(entry), paired: Boolean(entry.displayKeyHash) })),
          default_room_id: roster.defaultRoomId ?? null,
          meeting: meeting ? {
            room_id: meeting.session.roomId ?? null,
            revision: meeting.session.roomRevision ?? 0,
            accepting_until: meetingAcceptsRoomScan(meeting.session, now) ? meeting.session.roomCheckInUntil ?? null : null,
          } : null,
        };
      case "create": {
        const label = payload.label.trim().replace(/\s+/g, " ");
        if (!label || label.length > 80) return invalid;
        const labelKey = label.toLowerCase();
        const existing = await ctx.db.query("rooms").withIndex("by_organizationId_installation_labelKey", q =>
          q.eq("organizationId", roster.organizationId).eq("pikaInstallationRef", installationRef).eq("labelKey", labelKey)).unique();
        return { ...ok, room_id: existing?._id ?? await ctx.db.insert("rooms", {
          organizationId: roster.organizationId, createdByAppUserId: actor.appUser._id,
          label, labelKey, pikaInstallationRef: installationRef, qrRevision: createShareToken(), notices: [],
        }) };
      }
      case "default":
        if (room && !room.displayKeyHash) return unpaired;
        await ctx.db.patch(roster._id, { defaultRoomId: room?._id, updatedAt: now });
        return ok;
      case "move": {
        if (!room || !meeting) return unavailable;
        if (!room.displayKeyHash) return unpaired;
        const { session, occurrence } = meeting;
        if (session.roomId === room._id) return conflict;
        if ((await currentWindows(ctx, room._id, session.date, now)).length >= maxRoomMeetings) return conflict;
        const revision = await transferMeeting(ctx, session, room._id, now);
        await ctx.db.patch(session._id, { priorPikaRoomMode: session.roomMode === true, roomMode: true });
        await openPikaRoomWindow(ctx, { ...session, roomMode: true, roomId: room._id }, occurrence, now);
        if (payload.save_default) await ctx.db.patch(roster._id, { defaultRoomId: room._id, updatedAt: now });
        return { ...ok, revision };
      }
      case "undo": {
        if (!meeting) return unavailable;
        const { session } = meeting;
        if (!session.roomRevision || session.roomRevision !== payload.revision || session.priorPikaRoomMode === undefined) return conflict;
        if (session.priorRoomId) {
          const priorRoom = await pikaRoom(ctx, session.priorRoomId, installationRef);
          if (!priorRoom || priorRoom.organizationId !== roster.organizationId) return unavailable;
          if (!priorRoom.displayKeyHash) return unpaired;
          if ((await currentWindows(ctx, priorRoom._id, session.date, now)).length >= maxRoomMeetings) return conflict;
        }
        await transferMeeting(ctx, session, session.priorRoomId, now);
        await ctx.db.patch(session._id, {
          priorPikaRoomMode: undefined,
          ...(session.priorPikaRoomMode ? {} : {
            roomMode: undefined, roomCheckInUntil: undefined, checkInToken: await createUniqueCheckInToken(ctx),
          }),
        });
        return ok;
      }
      case "pair": {
        if (!room || !canManage(room)) return denied;
        const credential = createShareToken(40);
        await ctx.db.patch(room._id, { displayKeyHash: await sha256Hex(credential), qrRevision: createShareToken() });
        return { ...ok, credential };
      }
      case "revoke":
        if (!room || !canManage(room)) return denied;
        await ctx.db.patch(room._id, { displayKeyHash: undefined, qrRevision: createShareToken() });
        return ok;
      case "notices": {
        if (!room || !canManage(room)) return denied;
        const notices = payload.notices.map(line => line.trim()).filter(Boolean);
        if (notices.length > 10 || notices.some(line => line.length > 300)) return invalid;
        await ctx.db.patch(room._id, { notices });
        return ok;
      }
    }
  },
});
