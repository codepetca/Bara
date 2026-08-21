import { v } from "convex/values";
import { closeAttendanceSession, openAttendanceSession } from "./attendanceEngine";
import { requireAccessibleRoster } from "./auth";
import type { Doc, Id } from "./model";
import type { MutationCtx } from "./server";
import { mutation, query } from "./server";

export const getByIdForStaff = query({
  args: {
    sessionId: v.id("sessions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
        checkInToken: v.string(),
        createdAt: v.number(),
      }),
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    return {
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
        checkInToken: session.checkInToken,
        createdAt: session.createdAt,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
    };
  },
});

export const getActiveForRoster = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("sessions"),
      status: v.union(v.literal("open"), v.literal("closed")),
      checkInToken: v.string(),
      date: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const activeSession = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", args.rosterId).eq("status", "open"))
      .unique();

    if (!activeSession) {
      return null;
    }

    return {
      _id: activeSession._id,
      status: activeSession.status,
      checkInToken: activeSession.checkInToken,
      date: activeSession.date,
    };
  },
});

export const getCheckInContext = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
      }),
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", args.token))
      .unique();

    if (!session) {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return null;
    }

    return {
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
    };
  },
});

export const getDisplayContext = query({
  args: {
    sessionId: v.id("sessions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      rosterName: v.string(),
      checkInToken: v.string(),
      status: v.union(v.literal("open"), v.literal("closed")),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    return {
      title: session.title,
      rosterName: roster.name,
      checkInToken: session.checkInToken,
      status: session.status,
    };
  },
});

export const getDisplayContextByToken = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      rosterName: v.string(),
      checkInToken: v.string(),
      status: v.union(v.literal("open"), v.literal("closed")),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", args.token))
      .unique();
    if (!session) {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return null;
    }

    return {
      title: session.title,
      rosterName: roster.name,
      checkInToken: session.checkInToken,
      status: session.status,
    };
  },
});

export async function openRosterSession(
  ctx: MutationCtx,
  args: {
    roster: Doc<"rosters">;
    actorAppUserId: Id<"app_users">;
    date: string;
    title?: string;
    participantMode?: "verified" | "roster_only" | "mixed";
    now?: number;
  },
) {
  return openAttendanceSession(ctx, {
    roster: args.roster,
    actor: {
      actorType: "staff",
      appUserId: args.actorAppUserId,
      source: "standalone_authkit",
    },
    date: args.date,
    title: args.title,
    participantMode: args.participantMode,
    now: args.now,
  });
}

export async function closeRosterSession(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    actorAppUserId: Id<"app_users">;
    now?: number;
  },
) {
  return closeAttendanceSession(ctx, {
    session: args.session,
    actor: {
      actorType: "staff",
      appUserId: args.actorAppUserId,
      source: "standalone_authkit",
    },
    now: args.now,
  });
}

export const start = mutation({
  args: {
    rosterId: v.id("rosters"),
    date: v.string(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);
    return openAttendanceSession(ctx, {
      roster,
      actor: {
        actorType: "staff",
        appUserId: appUser._id,
        source: "standalone_authkit",
      },
      date: args.date,
    });
  },
});

export const create = start;

export const close = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    const { appUser } = await requireAccessibleRoster(ctx, session.rosterId);
    await closeAttendanceSession(ctx, {
      session,
      actor: {
        actorType: "staff",
        appUserId: appUser._id,
        source: "standalone_authkit",
      },
    });
    return null;
  },
});

export const stop = close;
