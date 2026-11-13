import { v } from "convex/values";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import { createShareToken } from "../lib/session-links";
import { internal } from "./api";
import { studentCheckInAttendance } from "./attendanceEngine";
import { requireAccessibleRoster, requireCurrentAppUser } from "./auth";
import type { Doc, Id } from "./model";
import {
  getOpenRosterMeeting,
  isStandaloneRoster,
  meetingAcceptsRoomScan,
  refreshRoomQr,
  roomDate,
  roomWindowEnd,
} from "./roomModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./server";

type ReadCtx = QueryCtx | MutationCtx;
const roomArgs = { rosterId: v.id("rosters"), roomId: v.id("rooms") };
const sessionArgs = { sessionId: v.id("sessions") };
const namedRoster = { rosterId: v.id("rosters"), name: v.string() };
const scanArgs = {
  roomId: v.id("rooms"),
  continuation: v.string(),
  browserKey: v.string(),
  asStudent: v.optional(v.boolean()),
};
const resultValidator = v.object({ name: v.string(), code: v.string() });
const invalidScan = { status: "invalid" as const, results: [] };
const maxRoomMeetings = 32;
const scanLifetime = 2 * 60_000;

async function roomForRoster(ctx: ReadCtx, roster: Doc<"rosters">, roomId: Id<"rooms">) {
  const room = await ctx.db.get(roomId);
  if (!room || room.organizationId !== roster.organizationId) {
    throw new Error("Room is unavailable.");
  }
  return room;
}

async function requireRoomManager(ctx: MutationCtx, args: { rosterId: Id<"rosters">; roomId: Id<"rooms"> }) {
  const { roster, appUser, membership } = await requireAccessibleRoster(ctx, args.rosterId);
  if (!(await isStandaloneRoster(ctx, roster._id))) throw new Error("Room QR is available for standalone Bara rosters.");
  const room = await roomForRoster(ctx, roster, args.roomId);
  if (membership.role !== "admin" && room.createdByAppUserId !== appUser._id) {
    throw new Error("Only the room creator or an administrator can manage this display.");
  }
  return room;
}

async function requireTodayMeeting(ctx: MutationCtx, sessionId: Id<"sessions">, now: number) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.status !== "open" || !session.roomMode || session.date !== roomDate(now)) {
    throw new Error("Choose an open room QR meeting for today.");
  }
  const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
  if (!(await isStandaloneRoster(ctx, roster._id))) throw new Error("Room QR is available for standalone Bara rosters.");
  return { session, roster };
}

async function currentWindows(ctx: ReadCtx, roomId: Id<"rooms">, date: string, now: number) {
  return ctx.db.query("sessions").withIndex("by_roomId_and_date_and_status_and_roomCheckInUntil", (q) =>
    q.eq("roomId", roomId).eq("date", date).eq("status", "open").gt("roomCheckInUntil", now),
  ).take(maxRoomMeetings);
}

function windowSnapshot(session: Doc<"sessions">) {
  return {
    sessionId: session._id,
    roomRevision: session.roomRevision ?? 0,
    windowRevision: session.roomWindowRevision ?? 0,
  };
}

async function roomProof(room: Doc<"rooms">, date: string, sessions: Doc<"sessions">[]) {
  if (!room.displayKeyHash || !sessions.length) return null;
  // The private nonce changes whenever a live window starts, stops or moves.
  // Including the live windows also retires a proof at automatic cutoff.
  return sha256Hex(JSON.stringify([room._id, date, sessions.map(windowSnapshot), room.qrRevision]));
}

export const listForRoster = query({
  args: { rosterId: v.id("rosters") },
  returns: v.object({
    rooms: v.array(v.object({ roomId: v.id("rooms"), label: v.string(), notices: v.array(v.string()), canManage: v.boolean() })),
    defaultRoomId: v.union(v.id("rooms"), v.null()),
    supported: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { roster, appUser, membership } = await requireAccessibleRoster(ctx, args.rosterId);
    const supported = await isStandaloneRoster(ctx, roster._id);
    const rooms = supported ? await ctx.db.query("rooms")
      .withIndex("by_organizationId_and_labelKey", (q) => q.eq("organizationId", roster.organizationId)).take(200) : [];
    return {
      rooms: rooms.map((room) => ({
        roomId: room._id, label: room.label, notices: room.notices,
        canManage: membership.role === "admin" || room.createdByAppUserId === appUser._id,
      })),
      defaultRoomId: roster.defaultRoomId ?? null,
      supported,
    };
  },
});

export const create = mutation({
  args: { rosterId: v.id("rosters"), label: v.string() },
  returns: v.id("rooms"),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);
    if (!(await isStandaloneRoster(ctx, roster._id))) throw new Error("Room QR is available for standalone Bara rosters.");
    const label = args.label.trim().replace(/\s+/g, " ");
    if (!label || label.length > 80) throw new Error("Enter a room name of up to 80 characters.");
    const labelKey = label.toLowerCase();
    const existing = await ctx.db.query("rooms").withIndex("by_organizationId_and_labelKey", (q) =>
      q.eq("organizationId", roster.organizationId).eq("labelKey", labelKey)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("rooms", {
      organizationId: roster.organizationId,
      createdByAppUserId: appUser._id,
      label, labelKey, qrRevision: createShareToken(), notices: [],
    });
  },
});

export const setDefault = mutation({
  args: { rosterId: v.id("rosters"), roomId: v.union(v.id("rooms"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);
    if (!(await isStandaloneRoster(ctx, roster._id))) throw new Error("Room QR is available for standalone Bara rosters.");
    if (args.roomId) await roomForRoster(ctx, roster, args.roomId);
    await ctx.db.patch(roster._id, { defaultRoomId: args.roomId ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

export const pairDisplay = mutation({
  args: roomArgs,
  returns: v.string(),
  handler: async (ctx, args) => {
    const room = await requireRoomManager(ctx, args);
    const credential = createShareToken(40);
    await ctx.db.patch(room._id, { displayKeyHash: await sha256Hex(credential), qrRevision: createShareToken() });
    return credential;
  },
});

export const revokeDisplay = mutation({
  args: roomArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireRoomManager(ctx, args);
    await ctx.db.patch(room._id, { displayKeyHash: undefined, qrRevision: createShareToken() });
    return null;
  },
});

export const setNotices = mutation({
  args: { ...roomArgs, notices: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireRoomManager(ctx, args);
    const notices = args.notices.map((line) => line.trim()).filter(Boolean);
    if (notices.length > 10 || notices.some((line) => line.length > 300)) {
      throw new Error("Enter up to 10 announcements of 300 characters each.");
    }
    await ctx.db.patch(room._id, { notices });
    return null;
  },
});

export const meeting = query({
  args: { ...sessionArgs, roomDateRefresh: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({
    roomId: v.union(v.id("rooms"), v.null()), label: v.union(v.string(), v.null()),
    mode: v.boolean(), today: v.boolean(), acceptingUntil: v.union(v.number(), v.null()),
  })),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    const room = session.roomId ? await roomForRoster(ctx, roster, session.roomId) : null;
    const now = Date.now();
    return {
      roomId: room?._id ?? null, label: room?.label ?? null, mode: session.roomMode === true,
      today: session.date === roomDate(now),
      acceptingUntil: meetingAcceptsRoomScan(session, now) ? session.roomCheckInUntil! : null,
    };
  },
});

export const startCheckIn = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, roster } = await requireTodayMeeting(ctx, args.sessionId, now);
    if (!session.roomId) throw new Error("Assign this meeting to a room first.");
    await roomForRoster(ctx, roster, session.roomId);
    if (meetingAcceptsRoomScan(session, now)) return null;
    const windows = await currentWindows(ctx, session.roomId, session.date, now);
    if (windows.length >= maxRoomMeetings) throw new Error("This room has too many check-ins open.");
    const occurrence = await ctx.db.query("attendance_occurrences")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id)).first();
    const scheduledEnd = occurrence?.closesAt ?? Infinity;
    const cutoff = Math.min(roomWindowEnd(now), scheduledEnd);
    if (cutoff <= now) throw new Error("This meeting has already ended.");
    await ctx.db.patch(session._id, {
      roomCheckInUntil: cutoff, roomWindowRevision: (session.roomWindowRevision ?? 0) + 1,
    });
    await ctx.scheduler.runAt(cutoff, internal.rooms.expireWindow, {
      sessionId: session._id, cutoff,
    });
    await refreshRoomQr(ctx, session.roomId);
    return null;
  },
});

export const stopCheckIn = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session } = await requireTodayMeeting(ctx, args.sessionId, now);
    if (!meetingAcceptsRoomScan(session, now)) return null;
    await ctx.db.patch(session._id, {
      roomCheckInUntil: undefined, roomWindowRevision: (session.roomWindowRevision ?? 0) + 1,
    });
    await refreshRoomQr(ctx, session.roomId);
    return null;
  },
});

async function transferMeeting(ctx: MutationCtx, session: Doc<"sessions">, roomId: Id<"rooms"> | undefined, now: number) {
  const accepting = meetingAcceptsRoomScan(session, now);
  if (accepting && roomId && (await currentWindows(ctx, roomId, session.date, now)).length >= maxRoomMeetings) {
    throw new Error("This room has too many check-ins open.");
  }
  const revision = (session.roomRevision ?? 0) + 1;
  await ctx.db.patch(session._id, {
    roomId,
    roomRevision: revision,
    priorRoomId: session.roomId,
    updatedAt: now,
  });
  if (accepting) {
    await refreshRoomQr(ctx, session.roomId);
    await refreshRoomQr(ctx, roomId);
  }
  return revision;
}

export const moveMeeting = mutation({
  args: { ...sessionArgs, roomId: v.id("rooms") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, roster } = await requireTodayMeeting(ctx, args.sessionId, now);
    await roomForRoster(ctx, roster, args.roomId);
    if (session.roomId === args.roomId) throw new Error("This meeting is already in this room.");
    return transferMeeting(ctx, session, args.roomId, now);
  },
});

export const undoMove = mutation({
  args: { ...sessionArgs, revision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, roster } = await requireTodayMeeting(ctx, args.sessionId, now);
    if (!session.roomRevision || session.roomRevision !== args.revision) throw new Error("The room assignment has changed.");
    if (session.priorRoomId) await roomForRoster(ctx, roster, session.priorRoomId);
    await transferMeeting(ctx, session, session.priorRoomId, now);
    return null;
  },
});

export const display = query({
  args: { roomId: v.id("rooms"), credential: v.string(), refresh: v.optional(v.number()) },
  returns: v.union(v.null(), v.object({
    label: v.string(), proof: v.union(v.string(), v.null()), nextChangeAt: v.union(v.number(), v.null()), notices: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room?.displayKeyHash || args.credential.length !== 40 ||
      room.displayKeyHash !== await sha256Hex(args.credential)) return null;
    if ((await ctx.db.get(room.organizationId))?.status !== "active") return null;
    const now = Date.now();
    const date = roomDate(now);
    const windows = await currentWindows(ctx, room._id, date, now);
    return {
      label: room.label,
      proof: await roomProof(room, date, windows),
      nextChangeAt: windows[0]?.roomCheckInUntil ?? null,
      notices: room.notices,
    };
  },
});

export const expireWindow = internalMutation({
  args: { ...sessionArgs, cutoff: v.number() },
  returns: v.null(),
  handler: async (ctx, { sessionId, cutoff }) => {
    const session = await ctx.db.get(sessionId);
    if (session?.status === "open" && session.roomCheckInUntil === cutoff && cutoff <= Date.now()) {
      await ctx.db.patch(sessionId, { roomCheckInUntil: undefined });
    }
    return null;
  },
});

export const expireScan = internalMutation({
  args: { scanId: v.id("room_scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    if (await ctx.db.get(scanId)) await ctx.db.delete(scanId);
    return null;
  },
});

export const beginScan = mutation({
  args: { roomId: v.id("rooms"), proof: v.string(), browserKey: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    if (!/^[a-f0-9]{64}$/.test(args.proof) || !validBrowserKey(args.browserKey)) return null;
    const room = await ctx.db.get(args.roomId);
    if (!room?.displayKeyHash || (await ctx.db.get(room.organizationId))?.status !== "active") return null;
    const now = Date.now();
    const date = roomDate(now);
    const windows = await currentWindows(ctx, room._id, date, now);
    if (args.proof !== await roomProof(room, date, windows)) return null;
    const token = createShareToken(40);
    const [tokenHash, browserKeyHash] = await Promise.all([sha256Hex(token), sha256Hex(args.browserKey)]);
    const expiresAt = now + scanLifetime;
    const scanId = await ctx.db.insert("room_scans", {
      roomId: room._id, tokenHash, browserKeyHash, date, expiresAt,
      displayKeyHash: room.displayKeyHash,
      windows: windows.map(windowSnapshot),
    });
    await ctx.scheduler.runAt(expiresAt, internal.rooms.expireScan, { scanId });
    return token;
  },
});

function validBrowserKey(value: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

async function findScan(ctx: ReadCtx, room: Doc<"rooms">, continuation: string, browserKey: string, now: number) {
  if (continuation.length !== 40 || !validBrowserKey(browserKey)) return null;
  const tokenHash = await sha256Hex(continuation);
  const scan = await ctx.db.query("room_scans").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
  if (!scan || scan.roomId !== room._id || scan.expiresAt <= now || scan.date !== roomDate(now) ||
    scan.displayKeyHash !== room.displayKeyHash || scan.browserKeyHash !== await sha256Hex(browserKey)) return null;
  return scan;
}

async function roomMembership(ctx: ReadCtx, appUserId: Id<"app_users">, room: Doc<"rooms">) {
  if ((await ctx.db.get(room.organizationId))?.status !== "active") return null;
  const membership = await ctx.db.query("organization_memberships").withIndex("by_appUserId_organizationId",
    (q) => q.eq("appUserId", appUserId).eq("organizationId", room.organizationId)).unique();
  return membership?.status === "active" ? membership : null;
}

async function eligibleScanMeetings(ctx: ReadCtx, room: Doc<"rooms">, scan: Doc<"room_scans">, now: number) {
  const meetings = await Promise.all(scan.windows.map(async (window) => {
    const session = await ctx.db.get(window.sessionId);
    if (!session || session.roomId !== room._id || !meetingAcceptsRoomScan(session, now) ||
      (session.roomRevision ?? 0) !== window.roomRevision ||
      (session.roomWindowRevision ?? 0) !== window.windowRevision) return null;
    const roster = await ctx.db.get(session.rosterId);
    if (!roster || roster.pikaDecommissioned || roster.organizationId !== room.organizationId ||
      !(await isStandaloneRoster(ctx, roster._id))) return null;
    return { session, roster };
  }));
  return meetings.filter((meeting) => meeting !== null);
}

async function hasStudentLink(ctx: ReadCtx, rosterId: Id<"rosters">, appUserId: Id<"app_users">) {
  const linked = await ctx.db.query("participants").withIndex("by_rosterId_and_linkedAppUserId",
    (q) => q.eq("rosterId", rosterId).eq("linkedAppUserId", appUserId)).take(2);
  return linked.some((participant) => participant.active && participant.linkStatus === "linked");
}

export const scanContext = query({
  args: { roomId: v.id("rooms"), continuation: v.optional(v.string()), browserKey: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({
    label: v.string(),
    date: v.string(),
    role: v.union(v.literal("staff"), v.literal("student"), v.literal("both"), v.literal("none")),
    canCheckIn: v.boolean(),
    meetings: v.array(v.object({ ...namedRoster, sessionId: v.id("sessions") })),
    rosters: v.array(v.object(namedRoster)),
  })),
  handler: async (ctx, args) => {
    const { appUser } = await requireCurrentAppUser(ctx);
    const room = await ctx.db.get(args.roomId);
    if (!room) return null;
    const member = await roomMembership(ctx, appUser._id, room);
    if (!member) return null;
    const now = Date.now();
    const date = roomDate(now);
    const scan = args.continuation && args.browserKey
      ? await findScan(ctx, room, args.continuation, args.browserKey, now) : null;
    const eligible = scan ? await eligibleScanMeetings(ctx, room, scan, now) : [];
    const staff = member.role !== "student";
    const dual = staff && (scan?.receipt?.appUserId === appUser._id ||
      (await Promise.all(eligible.map(({ roster }) => hasStudentLink(ctx, roster._id, appUser._id)))).some(Boolean));
    const entries = staff ? await ctx.db.query("roster_access")
      .withIndex("by_membershipId", (q) => q.eq("membershipId", member._id)).take(200) : [];
    const rosterOptions = await Promise.all(entries.map(async ({ rosterId }) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster || roster.pikaDecommissioned || roster.organizationId !== room.organizationId ||
        !(await isStandaloneRoster(ctx, rosterId))) return null;
      const session = await getOpenRosterMeeting(ctx, rosterId, date, true);
      return {
        rosterId,
        name: roster.name,
        sessionId: session?.roomMode && session.roomId !== room._id ? session._id : undefined,
      };
    }));
    const available = rosterOptions.filter((entry) => entry !== null);
    return {
      label: room.label,
      date,
      role: staff ? dual ? "both" as const : "staff" as const : "student" as const,
      canCheckIn: Boolean(scan && (eligible.length || scan.receipt?.appUserId === appUser._id)),
      rosters: available.map(({ rosterId, name }) => ({ rosterId, name })),
      meetings: available.flatMap(({ rosterId, name, sessionId }) => sessionId ? [{ rosterId, name, sessionId }] : []),
    };
  },
});

export const redeemScan = mutation({
  args: scanArgs,
  returns: v.object({ status: v.union(v.literal("complete"), v.literal("invalid")), results: v.array(resultValidator) }),
  handler: async (ctx, args) => {
    const { appUser } = await requireCurrentAppUser(ctx);
    const room = await ctx.db.get(args.roomId);
    if (!room) return invalidScan;
    const now = Date.now();
    const scan = await findScan(ctx, room, args.continuation, args.browserKey, now);
    if (!scan) return invalidScan;
    const membership = await roomMembership(ctx, appUser._id, room);
    if (!membership || (membership.role !== "student" && !args.asStudent)) return invalidScan;
    if (scan.receipt) {
      return scan.receipt.appUserId === appUser._id
        ? { status: "complete" as const, results: scan.receipt.results }
        : invalidScan;
    }

    const meetings = await eligibleScanMeetings(ctx, room, scan, now);
    if (!meetings.length) return invalidScan;
    const results = [];
    for (const { session, roster } of meetings) {
      if (membership.role !== "student" && !(await hasStudentLink(ctx, roster._id, appUser._id))) continue;
      const result = await studentCheckInAttendance(ctx, {
        session,
        actor: { actorType: "student", appUserId: appUser._id, source: "standalone_authkit" },
        roomScan: true,
        now,
      });
      if (result.code !== "not_on_roster" && result.code !== "not_authorized") {
        results.push({ name: roster.name, code: result.code });
      }
    }
    if (membership.role !== "student" && !results.length) return invalidScan;
    await ctx.db.patch(scan._id, { receipt: { appUserId: appUser._id, results } });
    return { status: "complete" as const, results };
  },
});
