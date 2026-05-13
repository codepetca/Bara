import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireAccessibleRoster } from "./auth";
import type { Doc } from "./model";
import {
  DEFAULT_AUTO_CLOSE_OFFSET_MINUTES,
  DEFAULT_AUTO_OPEN_OFFSET_MINUTES,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_TIMEZONE,
  resolveAutoCloseOffsetMinutes,
  resolveScheduleStartDate,
  scheduleConfigValidator,
  validateScheduleConfig,
  weekdayValidator,
} from "./scheduleConfig";
import {
  loadExternalLink,
  loadFutureClassDays,
  loadSchedule,
  upsertManagedSchedule,
} from "./scheduleState";
import { createSessionWithAttendanceRecords, closeSessionAndFinalize } from "./sessions";
import { mutation, query, type MutationCtx, type QueryCtx } from "./server";
import {
  getCandidateAutomationDates,
  getTodayForTimeZone,
  toUtcTimestamp,
} from "./scheduleHelpers";

async function loadLinkedSessionForClassDay(ctx: QueryCtx | MutationCtx, classDayId: Doc<"roster_class_days">["_id"]) {
  return ctx.db
    .query("sessions")
    .withIndex("by_scheduledClassDayId", (q) => q.eq("scheduledClassDayId", classDayId))
    .unique();
}

function getClassDayAutoCloseOffsetMinutes(classDay: { autoCloseOffsetMinutes?: number }) {
  return resolveAutoCloseOffsetMinutes(classDay.autoCloseOffsetMinutes);
}

function getScheduleAutoCloseOffsetMinutes(schedule: { autoCloseOffsetMinutes?: number }) {
  return resolveAutoCloseOffsetMinutes(schedule.autoCloseOffsetMinutes);
}

function getRosterMode(roster: { mode?: "standalone" | "pika_linked" }) {
  return roster.mode ?? "standalone";
}

async function buildScheduleDetails(ctx: QueryCtx, rosterId: Doc<"rosters">["_id"]) {
  const { roster } = await requireAccessibleRoster(ctx, rosterId);
  const [schedule, externalLink] = await Promise.all([
    loadSchedule(ctx, roster._id),
    loadExternalLink(ctx, roster._id),
  ]);
  const today = getTodayForTimeZone(schedule?.timezone ?? DEFAULT_TIMEZONE);
  const futureClassDays = await loadFutureClassDays(ctx, roster._id, today);

  return {
    mode: getRosterMode(roster),
    schedule,
    externalLink,
    upcomingClassDays: futureClassDays
      .filter((classDay) => classDay.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, 6),
  };
}

export const getForRoster = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.union(
    v.null(),
    v.object({
      mode: v.union(v.literal("standalone"), v.literal("pika_linked")),
      schedule: v.union(
        v.null(),
        v.object({
          startDate: v.string(),
          endDate: v.optional(v.string()),
          timezone: v.string(),
          weekdays: v.array(weekdayValidator),
          startMinutes: v.number(),
          endMinutes: v.number(),
          autoOpen: v.boolean(),
          autoOpenOffsetMinutes: v.number(),
          autoCloseOffsetMinutes: v.number(),
          autoCloseGraceMinutes: v.number(),
          active: v.boolean(),
        }),
      ),
      externalLink: v.union(
        v.null(),
        v.object({
          provider: v.literal("pika"),
          externalClassroomId: v.string(),
          syncStatus: v.union(v.literal("linked"), v.literal("sync_needed"), v.literal("error")),
          lastSyncedAt: v.optional(v.number()),
        }),
      ),
      upcomingClassDays: v.array(
        v.object({
          _id: v.id("roster_class_days"),
          date: v.string(),
          status: v.union(v.literal("scheduled"), v.literal("skipped")),
          source: v.union(v.literal("generated"), v.literal("manual_override"), v.literal("pika_sync")),
          timezone: v.string(),
          startMinutes: v.number(),
          endMinutes: v.number(),
          autoOpen: v.boolean(),
          autoOpenOffsetMinutes: v.number(),
          autoCloseOffsetMinutes: v.number(),
          autoCloseGraceMinutes: v.number(),
          linkedSessionStatus: v.union(v.literal("open"), v.literal("closed"), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const details = await buildScheduleDetails(ctx, args.rosterId);

    return {
      mode: details.mode,
      schedule: details.schedule
        ? {
            startDate: resolveScheduleStartDate(details.schedule.timezone, details.schedule.startDate),
            endDate: details.schedule.endDate,
            timezone: details.schedule.timezone,
            weekdays: details.schedule.weekdays,
            startMinutes: details.schedule.startMinutes,
            endMinutes: details.schedule.endMinutes,
            autoOpen: details.schedule.autoOpen,
            autoOpenOffsetMinutes: details.schedule.autoOpenOffsetMinutes,
            autoCloseOffsetMinutes: getScheduleAutoCloseOffsetMinutes(details.schedule),
            autoCloseGraceMinutes: details.schedule.autoCloseGraceMinutes,
            active: details.schedule.active,
          }
        : null,
      externalLink: details.externalLink
        ? {
            provider: details.externalLink.provider,
            externalClassroomId: details.externalLink.externalClassroomId,
            syncStatus: details.externalLink.syncStatus,
            lastSyncedAt: details.externalLink.lastSyncedAt,
          }
        : null,
      upcomingClassDays: await Promise.all(
        details.upcomingClassDays.map(async (classDay) => {
          const linkedSession = await loadLinkedSessionForClassDay(ctx, classDay._id);
          return {
            _id: classDay._id,
            date: classDay.date,
            status: classDay.status,
            source: classDay.source,
            timezone: classDay.timezone,
            startMinutes: classDay.startMinutes,
            endMinutes: classDay.endMinutes,
            autoOpen: classDay.autoOpen,
            autoOpenOffsetMinutes: classDay.autoOpenOffsetMinutes,
            autoCloseOffsetMinutes: getClassDayAutoCloseOffsetMinutes(classDay),
            autoCloseGraceMinutes: classDay.autoCloseGraceMinutes,
            linkedSessionStatus: linkedSession?.status ?? null,
          };
        }),
      ),
    };
  },
});

export const listUpcomingClassDays = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.array(
    v.object({
      _id: v.id("roster_class_days"),
      date: v.string(),
      status: v.union(v.literal("scheduled"), v.literal("skipped")),
      source: v.union(v.literal("generated"), v.literal("manual_override"), v.literal("pika_sync")),
      timezone: v.string(),
      startMinutes: v.number(),
      endMinutes: v.number(),
      autoOpen: v.boolean(),
      autoOpenOffsetMinutes: v.number(),
      autoCloseOffsetMinutes: v.number(),
      autoCloseGraceMinutes: v.number(),
      linkedSessionStatus: v.union(v.literal("open"), v.literal("closed"), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const details = await buildScheduleDetails(ctx, args.rosterId);
    return Promise.all(
      details.upcomingClassDays.map(async (classDay) => {
        const linkedSession = await loadLinkedSessionForClassDay(ctx, classDay._id);
        return {
          _id: classDay._id,
          date: classDay.date,
          status: classDay.status,
          source: classDay.source,
          timezone: classDay.timezone,
          startMinutes: classDay.startMinutes,
          endMinutes: classDay.endMinutes,
          autoOpen: classDay.autoOpen,
          autoOpenOffsetMinutes: classDay.autoOpenOffsetMinutes,
          autoCloseOffsetMinutes: getClassDayAutoCloseOffsetMinutes(classDay),
          autoCloseGraceMinutes: classDay.autoCloseGraceMinutes,
          linkedSessionStatus: linkedSession?.status ?? null,
        };
      }),
    );
  },
});

export const upsertForRoster = mutation({
  args: {
    rosterId: v.id("rosters"),
    config: scheduleConfigValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);
    if (getRosterMode(roster) !== "standalone") {
      throw new Error("Only standalone rosters can use a local recurring schedule.");
    }

    await upsertManagedSchedule(ctx, {
      rosterId: roster._id,
      config: args.config,
    });

    return null;
  },
});

export const setClassDayOverride = mutation({
  args: {
    rosterId: v.id("rosters"),
    date: v.string(),
    status: v.union(v.literal("scheduled"), v.literal("skipped")),
    startMinutes: v.optional(v.number()),
    endMinutes: v.optional(v.number()),
    timezone: v.optional(v.string()),
    autoOpen: v.optional(v.boolean()),
    autoOpenOffsetMinutes: v.optional(v.number()),
    autoCloseOffsetMinutes: v.optional(v.number()),
    autoCloseGraceMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);
    const [existingClassDay, schedule] = await Promise.all([
      ctx.db
        .query("roster_class_days")
        .withIndex("by_rosterId_and_date", (q) => q.eq("rosterId", roster._id).eq("date", args.date))
        .unique(),
      loadSchedule(ctx, roster._id),
    ]);

    const fallback = existingClassDay
      ? {
          startDate: args.date,
          endDate: args.date,
          timezone: existingClassDay.timezone,
          startMinutes: existingClassDay.startMinutes,
          endMinutes: existingClassDay.endMinutes,
          autoOpen: existingClassDay.autoOpen,
          autoOpenOffsetMinutes: existingClassDay.autoOpenOffsetMinutes,
          autoCloseOffsetMinutes: getClassDayAutoCloseOffsetMinutes(existingClassDay),
          autoCloseGraceMinutes: existingClassDay.autoCloseGraceMinutes,
        }
      : schedule
        ? {
            startDate: resolveScheduleStartDate(schedule.timezone, schedule.startDate),
            endDate: schedule.endDate,
            timezone: schedule.timezone,
            startMinutes: schedule.startMinutes,
            endMinutes: schedule.endMinutes,
            autoOpen: schedule.autoOpen,
            autoOpenOffsetMinutes: schedule.autoOpenOffsetMinutes,
            autoCloseOffsetMinutes: getScheduleAutoCloseOffsetMinutes(schedule),
            autoCloseGraceMinutes: schedule.autoCloseGraceMinutes,
          }
        : null;

    const timezone = args.timezone ?? fallback?.timezone ?? DEFAULT_TIMEZONE;
    const startMinutes = args.startMinutes ?? fallback?.startMinutes;
    const endMinutes = args.endMinutes ?? fallback?.endMinutes;
    const autoOpen = args.autoOpen ?? fallback?.autoOpen ?? true;
    const autoOpenOffsetMinutes =
      args.autoOpenOffsetMinutes ?? fallback?.autoOpenOffsetMinutes ?? DEFAULT_AUTO_OPEN_OFFSET_MINUTES;
    const autoCloseOffsetMinutes =
      args.autoCloseOffsetMinutes ?? fallback?.autoCloseOffsetMinutes ?? DEFAULT_AUTO_CLOSE_OFFSET_MINUTES;
    const autoCloseGraceMinutes =
      args.autoCloseGraceMinutes ?? fallback?.autoCloseGraceMinutes ?? DEFAULT_GRACE_MINUTES;

    if (startMinutes === undefined || endMinutes === undefined) {
      throw new Error("Class day overrides need a start and end time.");
    }

    const linkedSession = existingClassDay ? await loadLinkedSessionForClassDay(ctx, existingClassDay._id) : null;
    if (linkedSession && existingClassDay && existingClassDay.status !== args.status) {
      throw new Error("Attendance already exists for this class day.");
    }

    validateScheduleConfig({
      startDate: fallback?.startDate ?? args.date,
      endDate: fallback?.endDate,
      weekdays: ["monday"],
      startMinutes,
      endMinutes,
      autoOpenOffsetMinutes,
      autoCloseOffsetMinutes,
      autoCloseGraceMinutes,
    });

    const now = Date.now();
    if (existingClassDay) {
      await ctx.db.patch(existingClassDay._id, {
        status: args.status,
        source: "manual_override",
        timezone,
        startMinutes,
        endMinutes,
        autoOpen,
        autoOpenOffsetMinutes,
        autoCloseOffsetMinutes,
        autoCloseGraceMinutes,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("roster_class_days", {
        rosterId: roster._id,
        date: args.date,
        status: args.status,
        source: "manual_override",
        timezone,
        startMinutes,
        endMinutes,
        autoOpen,
        autoOpenOffsetMinutes,
        autoCloseOffsetMinutes,
        autoCloseGraceMinutes,
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

async function autoOpenDueClassDays(ctx: MutationCtx) {
  const now = Date.now();
  const dates = getCandidateAutomationDates();
  const classDays = (
    await Promise.all(
      dates.map((date) =>
        ctx.db
          .query("roster_class_days")
          .withIndex("by_status_and_date", (q) => q.eq("status", "scheduled").eq("date", date))
          .take(100),
      ),
    )
  ).flat();

  for (const classDay of classDays) {
    if (!classDay.autoOpen) {
      continue;
    }

    const openAt =
      toUtcTimestamp(classDay.date, classDay.startMinutes, classDay.timezone) -
      classDay.autoOpenOffsetMinutes * 60 * 1000;

    if (openAt > now) {
      continue;
    }

    const linkedSession = await ctx.db
      .query("sessions")
      .withIndex("by_scheduledClassDayId", (q) => q.eq("scheduledClassDayId", classDay._id))
      .unique();
    if (linkedSession) {
      continue;
    }

    const openSession = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", classDay.rosterId).eq("status", "open"))
      .unique();

    if (openSession) {
      if (openSession.date === classDay.date && !openSession.scheduledClassDayId) {
        await ctx.db.patch(openSession._id, {
          scheduledClassDayId: classDay._id,
          updatedAt: now,
        });
      }
      continue;
    }

    const roster = await ctx.db.get(classDay.rosterId);
    if (!roster) {
      continue;
    }

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", roster._id).eq("active", true))
      .collect();

    if (participants.length === 0) {
      continue;
    }

    await createSessionWithAttendanceRecords(ctx, {
      roster,
      participants,
      date: classDay.date,
      createdByAppUserId: roster.createdByAppUserId,
      openedByActorType: "system",
      scheduledClassDayId: classDay._id,
    });
  }
}

async function autoCloseExpiredSessions(ctx: MutationCtx) {
  const now = Date.now();
  const openSessions = await ctx.db
    .query("sessions")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .take(200);

  for (const session of openSessions) {
    if (!session.scheduledClassDayId) {
      continue;
    }

    const classDay = await ctx.db.get(session.scheduledClassDayId);
    if (!classDay) {
      continue;
    }

    const closeAt =
      toUtcTimestamp(classDay.date, classDay.endMinutes, classDay.timezone) -
      getClassDayAutoCloseOffsetMinutes(classDay) * 60 * 1000;

    if (closeAt > now) {
      continue;
    }

    await closeSessionAndFinalize(ctx, {
      session,
      closedByActorType: "system",
    });
  }
}

export const runAutomation = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await autoOpenDueClassDays(ctx);
    await autoCloseExpiredSessions(ctx);
    return null;
  },
});
