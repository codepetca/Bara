import { v } from "convex/values";
import { ensureCurrentAppUser, getCurrentAppUserWithIdentity, requireAccessibleRoster } from "./auth";
import {
  applyParticipantLink,
  resolveParticipantLink,
  syncParticipantAttendanceRecords,
} from "./participantLinks";
import { isPresentLikeStatus, normalizeSchoolEmail, normalizeStudentId } from "./domain";
import type { Doc, Id } from "./model";
import { loadSessionTokenTarget } from "./sessionTokens";
import type { MutationCtx, QueryCtx } from "./server";
import { mutation, query } from "./server";

type AttendanceRecordDoc = Doc<"attendance_records">;
type ParticipantDoc = Doc<"participants">;

function serializeEventMetadata(metadata?: Record<string, string | undefined>) {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

async function insertAttendanceEvent(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"sessions">;
    participantId?: Id<"participants">;
    actorAppUserId?: Id<"app_users">;
    actorType: "student" | "staff" | "system";
    eventType: "student_check_in" | "manual_mark" | "session_finalize";
    fromStatus?: "unmarked" | "present" | "late" | "absent";
    toStatus?: "unmarked" | "present" | "late" | "absent";
    result: "applied" | "duplicate" | "blocked" | "review_needed";
    reasonCode?: string;
    metadata?: Record<string, string | undefined>;
  },
) {
  await ctx.db.insert("attendance_events", {
    sessionId: args.sessionId,
    participantId: args.participantId,
    actorAppUserId: args.actorAppUserId,
    actorType: args.actorType,
    eventType: args.eventType,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    result: args.result,
    reasonCode: args.reasonCode,
    metadata: serializeEventMetadata(args.metadata),
    createdAt: Date.now(),
  });
}

async function loadSessionParticipants(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  participants: ParticipantDoc[],
  attendanceRecords: AttendanceRecordDoc[],
) {
  const attendanceByParticipantId = new Map<Id<"participants">, AttendanceRecordDoc>();
  for (const attendanceRecord of attendanceRecords) {
    attendanceByParticipantId.set(attendanceRecord.participantId, attendanceRecord);
  }

  return participants.map((participant) => {
    const attendanceRecord = attendanceByParticipantId.get(participant._id);
    return {
      participantId: participant._id,
      displayName: participant.displayName,
      firstName: participant.firstName,
      lastName: participant.lastName,
      studentId: participant.externalId ?? "",
      schoolEmail: participant.schoolEmail,
      status: attendanceRecord?.status ?? "unmarked",
      lastMarkedAt: attendanceRecord?.lastMarkedAt,
      modifiedAt: attendanceRecord?.modifiedAt ?? session.createdAt,
      linkStatus: participant.linkStatus,
      linkedAppUserId: participant.linkedAppUserId,
    };
  });
}

async function loadDisplayNameForParticipant(ctx: QueryCtx, participantId?: Id<"participants">) {
  if (!participantId) {
    return undefined;
  }

  const participant = await ctx.db.get(participantId);
  return participant?.displayName;
}

async function getSessionParticipantList(ctx: QueryCtx, session: Doc<"sessions">) {
  const [participants, attendanceRecords] = await Promise.all([
    ctx.db
      .query("participants")
      .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", session.rosterId))
      .collect(),
    ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect(),
  ]);
  const attendanceByParticipantId = new Set(attendanceRecords.map((record) => record.participantId));
  const visibleParticipants = participants.filter(
    (participant) => participant.active || attendanceByParticipantId.has(participant._id),
  );

  const rows = await loadSessionParticipants(ctx, session, visibleParticipants, attendanceRecords);
  rows.sort((left, right) => {
    return (
      left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
      left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
      left.studentId.localeCompare(right.studentId, undefined, { numeric: true, sensitivity: "base" })
    );
  });

  return {
    rows,
    counts: {
      total: rows.length,
      present: rows.filter((row) => row.status === "present").length,
      late: rows.filter((row) => row.status === "late").length,
      unmarked: rows.filter((row) => row.status === "unmarked").length,
      absent: rows.filter((row) => row.status === "absent").length,
    },
  };
}

async function buildLiveSessionResult(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  roster: Doc<"rosters">,
) {
  const sessionRows = await getSessionParticipantList(ctx, session);
  const unresolvedEvents = await ctx.db
    .query("attendance_events")
    .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "review_needed"))
    .collect();
  const blockedEvents = await ctx.db
    .query("attendance_events")
    .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "blocked"))
    .collect();

  const eventRows = await Promise.all(
    [...unresolvedEvents, ...blockedEvents]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 12)
      .map(async (event) => ({
        participantId: event.participantId,
        participantName: await loadDisplayNameForParticipant(ctx, event.participantId),
        result: event.result,
        reasonCode: event.reasonCode,
        createdAt: event.createdAt,
      })),
  );

  return {
    session: {
      _id: session._id,
      title: session.title,
      date: session.date,
      status: session.status,
      checkInToken: session.checkInToken,
    },
    roster: {
      _id: roster._id,
      name: roster.name,
    },
    counts: sessionRows.counts,
    rows: sessionRows.rows,
    unresolvedEvents: eventRows,
  };
}

async function buildPendingRosterSessionResult(
  ctx: QueryCtx,
  roster: Doc<"rosters">,
  token: string,
) {
  const participants = await ctx.db
    .query("participants")
    .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", roster._id).eq("active", true))
    .collect();

  const rows = participants.map((participant) => ({
    participantId: participant._id,
    displayName: participant.displayName,
    firstName: participant.firstName,
    lastName: participant.lastName,
    studentId: participant.externalId ?? "",
    schoolEmail: participant.schoolEmail,
    status: "unmarked" as const,
    lastMarkedAt: undefined,
    modifiedAt: roster.updatedAt,
    linkStatus: participant.linkStatus,
    linkedAppUserId: participant.linkedAppUserId,
  }));

  return {
    session: {
      title: roster.name,
      date: "",
      status: "not_open" as const,
      checkInToken: token,
    },
    roster: {
      _id: roster._id,
      name: roster.name,
    },
    counts: {
      total: rows.length,
      present: 0,
      late: 0,
      unmarked: rows.length,
      absent: 0,
    },
    rows,
    unresolvedEvents: [],
  };
}

async function applyManualAttendanceMark(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    participantId: Id<"participants">;
    nextStatus: "present" | "late" | "unmarked";
    actorAppUserId?: Id<"app_users">;
  },
) {
  const participant = await ctx.db.get(args.participantId);
  if (!participant || participant.rosterId !== args.session.rosterId) {
    throw new Error("Student not found in this session.");
  }

  const existingAttendance = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId_participantId", (q) =>
      q.eq("sessionId", args.session._id).eq("participantId", participant._id),
    )
    .unique();

  const now = Date.now();

  if (!existingAttendance) {
    await ctx.db.insert("attendance_records", {
      sessionId: args.session._id,
      participantId: participant._id,
      linkedAppUserId: participant.linkedAppUserId,
      status: args.nextStatus,
      source: "staff_manual",
      firstMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      modifiedAt: now,
      modifiedByAppUserId: args.actorAppUserId,
    });

    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      participantId: participant._id,
      actorAppUserId: args.actorAppUserId,
      actorType: "staff",
      eventType: "manual_mark",
      fromStatus: "unmarked",
      toStatus: args.nextStatus,
      result: "applied",
    });
    return null;
  }

  await ctx.db.patch(existingAttendance._id, {
    linkedAppUserId: participant.linkedAppUserId,
    status: args.nextStatus,
    source: "staff_manual",
    firstMarkedAt:
      args.nextStatus === "unmarked"
        ? existingAttendance.firstMarkedAt
        : existingAttendance.firstMarkedAt ?? now,
    lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
    modifiedAt: now,
    modifiedByAppUserId: args.actorAppUserId,
  });

  await insertAttendanceEvent(ctx, {
    sessionId: args.session._id,
    participantId: participant._id,
    actorAppUserId: args.actorAppUserId,
    actorType: "staff",
    eventType: "manual_mark",
    fromStatus: existingAttendance.status,
    toStatus: args.nextStatus,
    result: "applied",
  });

  return null;
}

async function findParticipantForStudent(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    organizationId: Id<"organizations">;
    appUserId: Id<"app_users">;
    membership: Doc<"organization_memberships">;
  },
) {
  const linkedParticipants = await ctx.db
    .query("participants")
    .withIndex("by_rosterId_and_linkedAppUserId", (q) =>
      q.eq("rosterId", args.rosterId).eq("linkedAppUserId", args.appUserId),
    )
    .collect();
  const activeLinkedParticipants = linkedParticipants.filter((participant) => participant.active);

  if (activeLinkedParticipants.length > 1) {
    return {
      kind: "review_needed" as const,
      reasonCode: "duplicate_linked_participants",
    };
  }

  if (activeLinkedParticipants.length === 1) {
    return {
      kind: "matched" as const,
      participant: activeLinkedParticipants[0]!,
    };
  }

  const normalizedStudentId = normalizeStudentId(args.membership.studentId);
  const normalizedSchoolEmail = normalizeSchoolEmail(args.membership.schoolEmail);

  const [studentIdMatches, schoolEmailMatches] = await Promise.all([
    normalizedStudentId
      ? ctx.db
          .query("participants")
          .withIndex("by_rosterId_and_studentId", (q) =>
            q.eq("rosterId", args.rosterId).eq("externalId", normalizedStudentId),
          )
          .collect()
      : Promise.resolve([] as ParticipantDoc[]),
    normalizedSchoolEmail
      ? ctx.db
          .query("participants")
          .withIndex("by_rosterId_and_schoolEmail", (q) =>
            q.eq("rosterId", args.rosterId).eq("schoolEmail", normalizedSchoolEmail),
          )
          .collect()
      : Promise.resolve([] as ParticipantDoc[]),
  ]);
  const activeStudentIdMatches = studentIdMatches.filter((participant) => participant.active);
  const activeSchoolEmailMatches = schoolEmailMatches.filter((participant) => participant.active);

  if (activeStudentIdMatches.length > 1 || activeSchoolEmailMatches.length > 1) {
    return {
      kind: "review_needed" as const,
      reasonCode:
        activeStudentIdMatches.length > 1 ? "duplicate_student_id" : "duplicate_school_email",
    };
  }

  const candidates = new Map<Id<"participants">, ParticipantDoc>();
  for (const candidate of [...activeStudentIdMatches, ...activeSchoolEmailMatches]) {
    candidates.set(candidate._id, candidate);
  }

  if (candidates.size !== 1) {
    return {
      kind: "blocked" as const,
      reasonCode: "not_on_roster",
    };
  }

  const participant = [...candidates.values()][0]!;
  if (participant.linkedAppUserId && participant.linkedAppUserId !== args.appUserId) {
    return {
      kind: "review_needed" as const,
      reasonCode: "linked_to_other_user",
    };
  }

  const resolution = await resolveParticipantLink(ctx, args.organizationId, {
    studentId: participant.externalId,
    schoolEmail: participant.schoolEmail,
  });

  if (resolution.kind !== "matched" || resolution.appUserId !== args.appUserId) {
    return {
      kind: "review_needed" as const,
      reasonCode: resolution.kind === "ambiguous" ? resolution.reasonCode : "not_on_roster",
    };
  }

  await applyParticipantLink(ctx, participant, {
    linkedAppUserId: args.appUserId,
    linkStatus: "linked",
    linkMethod: "self_check_in",
    linkedByAppUserId: args.appUserId,
  });

  const refreshedParticipant = await ctx.db.get(participant._id);
  if (!refreshedParticipant) {
    return {
      kind: "blocked" as const,
      reasonCode: "not_on_roster",
    };
  }

  await syncParticipantAttendanceRecords(ctx, refreshedParticipant);

  return {
    kind: "matched" as const,
    participant: refreshedParticipant,
  };
}

async function resolveStudentMembershipForCheckIn(
  ctx: MutationCtx,
  args: {
    roster: Doc<"rosters">;
    appUserId: Id<"app_users">;
    email?: string;
    emailVerified?: boolean;
  },
): Promise<
  | { kind: "ready"; membership: Doc<"organization_memberships"> }
  | {
      kind: "blocked" | "review_needed";
      reasonCode: string;
      metadata?: Record<string, string | undefined>;
    }
> {
  const existingMembership = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", args.appUserId).eq("organizationId", args.roster.organizationId),
    )
    .unique();

  if (existingMembership) {
    if (existingMembership.status === "active" && existingMembership.role === "student") {
      return { kind: "ready", membership: existingMembership };
    }

    return {
      kind: "blocked",
      reasonCode: "not_authorized",
      metadata: {
        studentId: existingMembership.studentId,
        schoolEmail: existingMembership.schoolEmail,
      },
    };
  }

  const normalizedEmail = normalizeSchoolEmail(args.email);
  if (!normalizedEmail || args.emailVerified !== true) {
    return {
      kind: "blocked",
      reasonCode: "not_authorized",
      metadata: {
        schoolEmail: normalizedEmail,
      },
    };
  }

  const matchingParticipants = await ctx.db
    .query("participants")
    .withIndex("by_rosterId_and_schoolEmail", (q) =>
      q.eq("rosterId", args.roster._id).eq("schoolEmail", normalizedEmail),
    )
    .collect();
  const activeMatches = matchingParticipants.filter((participant) => participant.active);

  if (activeMatches.length !== 1) {
    return {
      kind: activeMatches.length > 1 ? "review_needed" : "blocked",
      reasonCode: activeMatches.length > 1 ? "duplicate_school_email" : "not_authorized",
      metadata: {
        schoolEmail: normalizedEmail,
      },
    };
  }

  const participant = activeMatches[0]!;
  if (participant.linkedAppUserId && participant.linkedAppUserId !== args.appUserId) {
    return {
      kind: "review_needed",
      reasonCode: "linked_to_other_user",
      metadata: {
        studentId: participant.externalId,
        schoolEmail: participant.schoolEmail,
      },
    };
  }

  const existingEmailMemberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_organizationId_and_schoolEmail", (q) =>
      q.eq("organizationId", args.roster.organizationId).eq("schoolEmail", normalizedEmail),
    )
    .collect();
  const activeEmailMemberships = existingEmailMemberships.filter(
    (membership) => membership.status === "active" && membership.role === "student",
  );
  const linkedToOtherStudent = activeEmailMemberships.some(
    (membership) => membership.appUserId !== args.appUserId,
  );

  if (linkedToOtherStudent) {
    return {
      kind: "review_needed",
      reasonCode: "duplicate_school_email",
      metadata: {
        studentId: participant.externalId,
        schoolEmail: participant.schoolEmail,
      },
    };
  }

  const now = Date.now();
  const membershipId = await ctx.db.insert("organization_memberships", {
    appUserId: args.appUserId,
    organizationId: args.roster.organizationId,
    role: "student",
    status: "active",
    studentId: participant.externalId,
    schoolEmail: normalizedEmail,
    createdAt: now,
    updatedAt: now,
  });
  const membership = await ctx.db.get(membershipId);
  if (!membership) {
    throw new Error("Student membership could not be created.");
  }

  return {
    kind: "ready",
    membership,
  };
}

function buildStudentResult(args: {
  tone: "green" | "yellow" | "red";
  code:
    | "present_marked"
    | "already_present"
    | "already_late"
    | "review_needed"
    | "not_on_roster"
    | "session_not_open"
    | "session_closed"
    | "invalid_token"
    | "not_authorized";
  title: string;
  description: string;
  attendanceStatus?: "unmarked" | "present" | "late" | "absent";
  checkedInAt?: number;
  student?: {
    displayName: string;
    studentId?: string;
  };
}) {
  return args;
}

const liveSessionResult = v.object({
  session: v.object({
    _id: v.optional(v.id("sessions")),
    title: v.string(),
    date: v.string(),
    status: v.union(v.literal("open"), v.literal("closed"), v.literal("not_open")),
    checkInToken: v.string(),
  }),
  roster: v.object({
    _id: v.id("rosters"),
    name: v.string(),
  }),
  counts: v.object({
    total: v.number(),
    present: v.number(),
    late: v.number(),
    unmarked: v.number(),
    absent: v.number(),
  }),
  rows: v.array(
    v.object({
      participantId: v.id("participants"),
      displayName: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      studentId: v.string(),
      schoolEmail: v.optional(v.string()),
      status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
      lastMarkedAt: v.optional(v.number()),
      modifiedAt: v.number(),
      linkStatus: v.union(
        v.literal("linked"),
        v.literal("unlinked"),
        v.literal("ambiguous"),
        v.literal("review_needed"),
      ),
      linkedAppUserId: v.optional(v.id("app_users")),
    }),
  ),
  unresolvedEvents: v.array(
    v.object({
      participantId: v.optional(v.id("participants")),
      participantName: v.optional(v.string()),
      result: v.union(
        v.literal("applied"),
        v.literal("duplicate"),
        v.literal("blocked"),
        v.literal("review_needed"),
      ),
      reasonCode: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
});

const studentCheckInResult = v.object({
  tone: v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
  code: v.union(
    v.literal("present_marked"),
    v.literal("already_present"),
    v.literal("already_late"),
    v.literal("review_needed"),
    v.literal("not_on_roster"),
    v.literal("session_not_open"),
    v.literal("session_closed"),
    v.literal("invalid_token"),
    v.literal("not_authorized"),
  ),
  title: v.string(),
  description: v.string(),
  attendanceStatus: v.optional(
    v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
  ),
  checkedInAt: v.optional(v.number()),
  student: v.optional(
    v.object({
      displayName: v.string(),
      studentId: v.optional(v.string()),
    }),
  ),
});

export const getLiveSessionRows = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.null(), liveSessionResult),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    return await buildLiveSessionResult(ctx, session, roster);
  },
});

export const getLiveSessionRowsByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), liveSessionResult),
  handler: async (ctx, args) => {
    const target = await loadSessionTokenTarget(ctx, args.token);
    if (!target) {
      return null;
    }

    if (!target.session) {
      return await buildPendingRosterSessionResult(ctx, target.roster, target.token);
    }

    return await buildLiveSessionResult(ctx, target.session, target.roster);
  },
});

export const getSessionExport = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
      }),
      rows: v.array(
        v.object({
          studentId: v.string(),
          schoolEmail: v.optional(v.string()),
          rawName: v.string(),
          displayName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
          present: v.boolean(),
          markedAt: v.optional(v.number()),
          modifiedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const [{ appUser }, session] = await Promise.all([
      getCurrentAppUserWithIdentity(ctx),
      ctx.db.get(args.sessionId),
    ]);

    if (!appUser || !session) {
      return null;
    }

    try {
      await requireAccessibleRoster(ctx, session.rosterId);
    } catch {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return null;
    }

    const [participants, attendanceRecords] = await Promise.all([
      ctx.db
        .query("participants")
        .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", session.rosterId))
        .collect(),
      ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .collect(),
    ]);

    const attendanceByParticipantId = new Map<Id<"participants">, AttendanceRecordDoc>();
    for (const attendanceRecord of attendanceRecords) {
      attendanceByParticipantId.set(attendanceRecord.participantId, attendanceRecord);
    }

    const sortableRows = participants.map((participant) => {
      const attendanceRecord = attendanceByParticipantId.get(participant._id);
      const status = attendanceRecord?.status ?? "unmarked";
      return {
        sortKey: participant.sortKey,
        row: {
          studentId: participant.externalId ?? "",
          schoolEmail: participant.schoolEmail,
          rawName: participant.rawName,
          displayName: participant.displayName,
          firstName: participant.firstName,
          lastName: participant.lastName,
          status,
          present: isPresentLikeStatus(status),
          markedAt: attendanceRecord?.lastMarkedAt,
          modifiedAt: attendanceRecord?.modifiedAt ?? session.createdAt,
        },
      };
    });

    sortableRows.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const rows = sortableRows.map((entry) => entry.row);

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
      },
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
      },
      rows,
    };
  },
});

export const markManual = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    nextStatus: v.union(v.literal("present"), v.literal("late"), v.literal("unmarked")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    if (session.status !== "open") {
      throw new Error("This session is closed.");
    }

    const { appUser } = await requireAccessibleRoster(ctx, session.rosterId);

    return await applyManualAttendanceMark(ctx, {
      session,
      participantId: args.participantId,
      nextStatus: args.nextStatus,
      actorAppUserId: appUser._id,
    });
  },
});

export const markManualByToken = mutation({
  args: {
    token: v.string(),
    participantId: v.id("participants"),
    nextStatus: v.union(v.literal("present"), v.literal("late"), v.literal("unmarked")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await loadSessionTokenTarget(ctx, args.token);
    if (!target) {
      throw new Error("Session not found.");
    }

    const session = target.session;
    if (!session) {
      throw new Error("Attendance is not open.");
    }

    if (session.status !== "open") {
      throw new Error("This session is closed.");
    }

    return await applyManualAttendanceMark(ctx, {
      session,
      participantId: args.participantId,
      nextStatus: args.nextStatus,
    });
  },
});

export const studentCheckIn = mutation({
  args: {
    token: v.string(),
  },
  returns: studentCheckInResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const target = await loadSessionTokenTarget(ctx, args.token);

    if (!target) {
      return buildStudentResult({
        tone: "red",
        code: "invalid_token",
        title: "Check-in link is invalid",
        description: "Ask your teacher for the current classroom QR code.",
        checkedInAt: now,
      });
    }

    const appUser = await ensureCurrentAppUser(ctx);

    if (!target.session) {
      return buildStudentResult({
        tone: "yellow",
        code: "session_not_open",
        title: "Attendance is not open yet",
        description: "Ask your teacher when check-in starts.",
        checkedInAt: now,
      });
    }

    const session = target.session;
    const roster = target.roster;

    if (session.status !== "open") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "blocked",
        reasonCode: "session_closed",
      });

      return buildStudentResult({
        tone: "red",
        code: "session_closed",
        title: "This session is closed",
        description: "Ask staff to help you check in manually.",
        checkedInAt: now,
      });
    }

    const membershipResolution = await resolveStudentMembershipForCheckIn(ctx, {
      roster,
      appUserId: appUser._id,
      email: appUser.identity?.email,
      emailVerified: appUser.identity?.emailVerified,
    });

    if (membershipResolution.kind !== "ready") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: membershipResolution.kind === "review_needed" ? "review_needed" : "blocked",
        reasonCode: membershipResolution.reasonCode,
        metadata: membershipResolution.metadata,
      });

      if (membershipResolution.kind === "review_needed") {
        return buildStudentResult({
          tone: "yellow",
          code: "review_needed",
          title: "Staff review is needed",
          description: "Your account needs help matching this roster. Ask staff to tap you in.",
          checkedInAt: now,
          student: {
            displayName: appUser.displayName,
            studentId: membershipResolution.metadata?.studentId,
          },
        });
      }

      return buildStudentResult({
        tone: "red",
        code: "not_authorized",
        title: "You cannot check in to this class",
        description: "Your account is not an active student for this roster.",
        checkedInAt: now,
      });
    }
    const membership = membershipResolution.membership;

    const participantMatch = await findParticipantForStudent(ctx, {
      rosterId: roster._id,
      organizationId: roster.organizationId,
      appUserId: appUser._id,
      membership,
    });

    if (participantMatch.kind === "blocked") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "blocked",
        reasonCode: participantMatch.reasonCode,
        metadata: {
          studentId: membership.studentId,
          schoolEmail: membership.schoolEmail,
        },
      });

      return buildStudentResult({
        tone: "red",
        code: "not_on_roster",
        title: "You are not on this roster",
        description: "Ask staff to check you in manually.",
        checkedInAt: now,
        student: {
          displayName: appUser.displayName,
          studentId: membership.studentId || undefined,
        },
      });
    }

    if (participantMatch.kind === "review_needed") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "review_needed",
        reasonCode: participantMatch.reasonCode,
        metadata: {
          studentId: membership.studentId,
          schoolEmail: membership.schoolEmail,
        },
      });

      return buildStudentResult({
        tone: "yellow",
        code: "review_needed",
        title: "Staff review is needed",
        description: "Your account needs help matching this roster. Ask staff to tap you in.",
        checkedInAt: now,
        student: {
          displayName: appUser.displayName,
          studentId: membership.studentId || undefined,
        },
      });
    }

    const attendanceRecord = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participantMatch.participant._id),
      )
      .unique();

    if (!attendanceRecord) {
      await ctx.db.insert("attendance_records", {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        linkedAppUserId: appUser._id,
        status: "present",
        source: "student_qr",
        firstMarkedAt: now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "unmarked",
        toStatus: "present",
        result: "applied",
      });

      return buildStudentResult({
        tone: "green",
        code: "present_marked",
        title: "You are checked in",
        description: "Attendance recorded successfully.",
        attendanceStatus: "present",
        checkedInAt: now,
        student: {
          displayName: participantMatch.participant.displayName,
          studentId: participantMatch.participant.externalId || membership.studentId || undefined,
        },
      });
    }

    if (attendanceRecord.status === "unmarked") {
      await ctx.db.patch(attendanceRecord._id, {
        linkedAppUserId: appUser._id,
        status: "present",
        source: "student_qr",
        firstMarkedAt: attendanceRecord.firstMarkedAt ?? now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "unmarked",
        toStatus: "present",
        result: "applied",
      });

      return buildStudentResult({
        tone: "green",
        code: "present_marked",
        title: "You are checked in",
        description: "Attendance recorded successfully.",
        attendanceStatus: "present",
        checkedInAt: now,
        student: {
          displayName: participantMatch.participant.displayName,
          studentId: participantMatch.participant.externalId || membership.studentId || undefined,
        },
      });
    }

    if (attendanceRecord.status === "present") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "present",
        toStatus: "present",
        result: "duplicate",
      });

      return buildStudentResult({
        tone: "yellow",
        code: "already_present",
        title: "You are already checked in",
        description: "No further action is needed.",
        attendanceStatus: "present",
        checkedInAt: attendanceRecord.lastMarkedAt ?? attendanceRecord.modifiedAt,
        student: {
          displayName: participantMatch.participant.displayName,
          studentId: participantMatch.participant.externalId || membership.studentId || undefined,
        },
      });
    }

    if (attendanceRecord.status === "late") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "late",
        toStatus: "late",
        result: "duplicate",
      });

      return buildStudentResult({
        tone: "yellow",
        code: "already_late",
        title: "You have already been marked late",
        description: "Please check with staff if this needs to change.",
        attendanceStatus: "late",
        checkedInAt: attendanceRecord.lastMarkedAt ?? attendanceRecord.modifiedAt,
        student: {
          displayName: participantMatch.participant.displayName,
          studentId: participantMatch.participant.externalId || membership.studentId || undefined,
        },
      });
    }

    await insertAttendanceEvent(ctx, {
      sessionId: session._id,
      participantId: participantMatch.participant._id,
      actorAppUserId: appUser._id,
      actorType: "student",
      eventType: "student_check_in",
      fromStatus: attendanceRecord.status,
      toStatus: attendanceRecord.status,
      result: "review_needed",
      reasonCode: "manual_override_present",
    });

    return buildStudentResult({
      tone: "yellow",
      code: "review_needed",
      title: "Staff review is needed",
      description: "Your attendance was already adjusted by staff. Ask them if this should change.",
      attendanceStatus: attendanceRecord.status,
      student: {
        displayName: participantMatch.participant.displayName,
        studentId: participantMatch.participant.externalId || membership.studentId || undefined,
      },
    });
  },
});
