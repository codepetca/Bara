import { v } from "convex/values";
import { requireAccessibleRoster } from "./auth";
import type { Doc, Id } from "./model";
import type { MutationCtx } from "./server";
import { mutation, query } from "./server";
import { createUniqueShareToken } from "./shareTokens";
import { loadSessionTokenTarget } from "./sessionTokens";

async function findScheduledClassDayForRosterDate(
  ctx: MutationCtx,
  rosterId: Id<"rosters">,
  date: string,
) {
  const classDay = await ctx.db
    .query("roster_class_days")
    .withIndex("by_rosterId_and_date", (q) => q.eq("rosterId", rosterId).eq("date", date))
    .unique();

  if (!classDay || classDay.status !== "scheduled") {
    return null;
  }

  return classDay;
}

export async function createSessionWithAttendanceRecords(
  ctx: MutationCtx,
  args: {
    roster: Doc<"rosters">;
    participants: Doc<"participants">[];
    date: string;
    createdByAppUserId: Id<"app_users">;
    openedByActorType: "staff" | "system";
    openedByAppUserId?: Id<"app_users">;
    scheduledClassDayId?: Id<"roster_class_days">;
  },
) {
  const createdAt = Date.now();
  const checkInToken = await createUniqueShareToken(ctx);
  const matchingClassDay = args.scheduledClassDayId
    ? await ctx.db.get(args.scheduledClassDayId)
    : await findScheduledClassDayForRosterDate(ctx, args.roster._id, args.date);
  const scheduledClassDayId =
    matchingClassDay && matchingClassDay.rosterId === args.roster._id ? matchingClassDay._id : undefined;

  const sessionId = await ctx.db.insert("sessions", {
    rosterId: args.roster._id,
    scheduledClassDayId,
    title: args.roster.name,
    date: args.date,
    sessionType: scheduledClassDayId ? "recurring_class" : "event",
    participantMode: "verified",
    status: "open",
    createdByAppUserId: args.createdByAppUserId,
    checkInToken,
    createdAt,
    updatedAt: createdAt,
    openedAt: createdAt,
    openedByActorType: args.openedByActorType,
    openedByAppUserId: args.openedByAppUserId,
  });

  for (const participant of args.participants) {
    await ctx.db.insert("attendance_records", {
      sessionId,
      participantId: participant._id,
      linkedAppUserId: participant.linkedAppUserId,
      status: "unmarked",
      modifiedAt: createdAt,
    });
  }

  return sessionId;
}

export async function closeSessionAndFinalize(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    closedByActorType: "staff" | "system";
    closedByAppUserId?: Id<"app_users">;
  },
) {
  if (args.session.status === "closed") {
    return null;
  }

  const attendanceRows = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", args.session._id))
    .collect();

  const now = Date.now();

  for (const attendanceRow of attendanceRows) {
    if (attendanceRow.status !== "unmarked") {
      continue;
    }

    await ctx.db.patch(attendanceRow._id, {
      status: "absent",
      source: "system_finalize",
      modifiedAt: now,
      modifiedByAppUserId: args.closedByAppUserId,
    });

    await ctx.db.insert("attendance_events", {
      sessionId: args.session._id,
      participantId: attendanceRow.participantId,
      actorAppUserId: args.closedByAppUserId,
      actorType: args.closedByActorType,
      eventType: "session_finalize",
      fromStatus: "unmarked",
      toStatus: "absent",
      result: "applied",
      createdAt: now,
    });
  }

  await ctx.db.patch(args.session._id, {
    status: "closed",
    closedAt: now,
    closedByActorType: args.closedByActorType,
    closedByAppUserId: args.closedByAppUserId,
    updatedAt: now,
  });

  return null;
}

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
        _id: v.optional(v.id("sessions")),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed"), v.literal("not_open")),
      }),
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const target = await loadSessionTokenTarget(ctx, args.token);
    if (!target) {
      return null;
    }

    const session = target.session;
    const status: "open" | "closed" | "not_open" = session?.status ?? "not_open";

    return {
      session: {
        _id: session?._id,
        title: session?.title ?? target.roster.name,
        date: session?.date ?? "",
        status,
      },
      roster: {
        _id: target.roster._id,
        name: target.roster.name,
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
      status: v.union(v.literal("open"), v.literal("closed"), v.literal("not_open")),
    }),
  ),
  handler: async (ctx, args) => {
    const target = await loadSessionTokenTarget(ctx, args.token);
    if (!target) {
      return null;
    }

    const session = target.session;
    const status: "open" | "closed" | "not_open" = session?.status ?? "not_open";

    return {
      title: session?.title ?? target.roster.name,
      rosterName: target.roster.name,
      checkInToken: target.kind === "roster" ? target.token : session!.checkInToken,
      status,
    };
  },
});

export const start = mutation({
  args: {
    rosterId: v.id("rosters"),
    date: v.string(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

    const existingOpenSession = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", args.rosterId).eq("status", "open"))
      .unique();

    if (existingOpenSession) {
      throw new Error("This roster already has an active session.");
    }

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) =>
        q.eq("rosterId", args.rosterId).eq("active", true),
      )
      .collect();

    if (participants.length === 0) {
      throw new Error("Roster has no active students.");
    }

    return await createSessionWithAttendanceRecords(ctx, {
      roster,
      participants,
      date: args.date,
      createdByAppUserId: appUser._id,
      openedByActorType: "staff",
      openedByAppUserId: appUser._id,
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
    return await closeSessionAndFinalize(ctx, {
      session,
      closedByActorType: "staff",
      closedByAppUserId: appUser._id,
    });
  },
});

export const stop = close;
