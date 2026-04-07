import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireAccessibleRoster } from "./auth";
import type { Doc } from "./model";
import { createSessionWithAttendanceRecords, closeSessionAndFinalize } from "./sessions";
import { mutation, query, type MutationCtx, type QueryCtx } from "./server";
import {
  getCandidateAutomationDates,
  getTodayForTimeZone,
  listRecurringDates,
  toUtcTimestamp,
  weekdayValues,
  type Weekday,
} from "./scheduleHelpers";

const weekdayValidator = v.union(
  v.literal("monday"),
  v.literal("tuesday"),
  v.literal("wednesday"),
  v.literal("thursday"),
  v.literal("friday"),
  v.literal("saturday"),
  v.literal("sunday"),
);

const DEFAULT_TIMEZONE = "America/Toronto";
const DEFAULT_GRACE_MINUTES = 10;

const scheduleConfigValidator = v.object({
  timezone: v.string(),
  weekdays: v.array(weekdayValidator),
  startMinutes: v.number(),
  endMinutes: v.number(),
  autoOpen: v.boolean(),
  autoCloseGraceMinutes: v.number(),
  active: v.boolean(),
});

function normalizeWeekdays(weekdays: Weekday[]) {
  const deduped = [...new Set(weekdays)];
  return weekdayValues.filter((weekday) => deduped.includes(weekday));
}

function validateScheduleConfig(config: {
  weekdays: Weekday[];
  startMinutes: number;
  endMinutes: number;
  autoCloseGraceMinutes: number;
}) {
  if (config.startMinutes < 0 || config.startMinutes >= 24 * 60) {
    throw new Error("Start time must be within the day.");
  }

  if (config.endMinutes <= config.startMinutes || config.endMinutes > 24 * 60) {
    throw new Error("End time must be after the start time.");
  }

  if (config.autoCloseGraceMinutes < 0 || config.autoCloseGraceMinutes > 180) {
    throw new Error("Grace time must be between 0 and 180 minutes.");
  }

  if (config.weekdays.length === 0) {
    throw new Error("Pick at least one class day.");
  }
}

async function loadSchedule(ctx: QueryCtx | MutationCtx, rosterId: Doc<"rosters">["_id"]) {
  return ctx.db
    .query("roster_schedules")
    .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId))
    .unique();
}

async function loadExternalLink(ctx: QueryCtx | MutationCtx, rosterId: Doc<"rosters">["_id"]) {
  return ctx.db
    .query("roster_external_links")
    .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId))
    .unique();
}

async function loadFutureClassDays(
  ctx: QueryCtx | MutationCtx,
  rosterId: Doc<"rosters">["_id"],
  fromDate: string,
) {
  return ctx.db
    .query("roster_class_days")
    .withIndex("by_rosterId_and_date", (q) => q.eq("rosterId", rosterId).gte("date", fromDate))
    .collect();
}

async function syncGeneratedClassDays(
  ctx: MutationCtx,
  args: {
    rosterId: Doc<"rosters">["_id"];
    schedule: Doc<"roster_schedules">;
  },
) {
  const fromDate = getTodayForTimeZone(args.schedule.timezone);
  const existingRows = await loadFutureClassDays(ctx, args.rosterId, fromDate);
  const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
  const targetDates = new Set(
    args.schedule.active
      ? listRecurringDates({
          weekdays: args.schedule.weekdays as Weekday[],
          timeZone: args.schedule.timezone,
        })
      : [],
  );
  const now = Date.now();

  for (const row of existingRows) {
    if (row.source !== "generated") {
      continue;
    }

    if (!targetDates.has(row.date)) {
      const linkedSession = await ctx.db
        .query("sessions")
        .withIndex("by_scheduledClassDayId", (q) => q.eq("scheduledClassDayId", row._id))
        .unique();

      if (linkedSession) {
        continue;
      }

      await ctx.db.delete(row._id);
      continue;
    }

    if (
      row.timezone !== args.schedule.timezone ||
      row.startMinutes !== args.schedule.startMinutes ||
      row.endMinutes !== args.schedule.endMinutes ||
      row.autoOpen !== args.schedule.autoOpen ||
      row.autoCloseGraceMinutes !== args.schedule.autoCloseGraceMinutes
    ) {
      await ctx.db.patch(row._id, {
        timezone: args.schedule.timezone,
        startMinutes: args.schedule.startMinutes,
        endMinutes: args.schedule.endMinutes,
        autoOpen: args.schedule.autoOpen,
        autoCloseGraceMinutes: args.schedule.autoCloseGraceMinutes,
        updatedAt: now,
      });
    }
  }

  for (const date of targetDates) {
    const existingRow = existingByDate.get(date);
    if (existingRow && existingRow.source !== "generated") {
      continue;
    }

    if (existingRow) {
      continue;
    }

    await ctx.db.insert("roster_class_days", {
      rosterId: args.rosterId,
      date,
      status: "scheduled",
      source: "generated",
      timezone: args.schedule.timezone,
      startMinutes: args.schedule.startMinutes,
      endMinutes: args.schedule.endMinutes,
      autoOpen: args.schedule.autoOpen,
      autoCloseGraceMinutes: args.schedule.autoCloseGraceMinutes,
      createdAt: now,
      updatedAt: now,
    });
  }
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
    mode: roster.mode,
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
          timezone: v.string(),
          weekdays: v.array(weekdayValidator),
          startMinutes: v.number(),
          endMinutes: v.number(),
          autoOpen: v.boolean(),
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
          autoCloseGraceMinutes: v.number(),
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
            timezone: details.schedule.timezone,
            weekdays: details.schedule.weekdays,
            startMinutes: details.schedule.startMinutes,
            endMinutes: details.schedule.endMinutes,
            autoOpen: details.schedule.autoOpen,
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
      upcomingClassDays: details.upcomingClassDays
        .map((classDay) => ({
          _id: classDay._id,
          date: classDay.date,
          status: classDay.status,
          source: classDay.source,
          timezone: classDay.timezone,
          startMinutes: classDay.startMinutes,
          endMinutes: classDay.endMinutes,
          autoOpen: classDay.autoOpen,
          autoCloseGraceMinutes: classDay.autoCloseGraceMinutes,
        })),
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
      autoCloseGraceMinutes: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const details = await buildScheduleDetails(ctx, args.rosterId);
    return details.upcomingClassDays.map((classDay) => ({
      _id: classDay._id,
      date: classDay.date,
      status: classDay.status,
      source: classDay.source,
      timezone: classDay.timezone,
      startMinutes: classDay.startMinutes,
      endMinutes: classDay.endMinutes,
      autoOpen: classDay.autoOpen,
      autoCloseGraceMinutes: classDay.autoCloseGraceMinutes,
    }));
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
    if (roster.mode !== "standalone") {
      throw new Error("Only standalone rosters can use a local recurring schedule.");
    }

    const weekdays = normalizeWeekdays(args.config.weekdays as Weekday[]);
    validateScheduleConfig({
      weekdays,
      startMinutes: args.config.startMinutes,
      endMinutes: args.config.endMinutes,
      autoCloseGraceMinutes: args.config.autoCloseGraceMinutes,
    });

    const existingSchedule = await loadSchedule(ctx, roster._id);
    const now = Date.now();
    const schedulePatch = {
      timezone: args.config.timezone,
      weekdays,
      startMinutes: args.config.startMinutes,
      endMinutes: args.config.endMinutes,
      autoOpen: args.config.autoOpen,
      autoCloseGraceMinutes: args.config.autoCloseGraceMinutes,
      active: args.config.active,
      updatedAt: now,
    };

    let scheduleId = existingSchedule?._id;
    if (existingSchedule) {
      await ctx.db.patch(existingSchedule._id, schedulePatch);
    } else {
      scheduleId = await ctx.db.insert("roster_schedules", {
        rosterId: roster._id,
        createdAt: now,
        ...schedulePatch,
      });
    }

    const nextSchedule = scheduleId ? await ctx.db.get(scheduleId) : null;
    if (!nextSchedule) {
      throw new Error("Could not save the roster schedule.");
    }

    await syncGeneratedClassDays(ctx, {
      rosterId: roster._id,
      schedule: nextSchedule,
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
          timezone: existingClassDay.timezone,
          startMinutes: existingClassDay.startMinutes,
          endMinutes: existingClassDay.endMinutes,
          autoOpen: existingClassDay.autoOpen,
          autoCloseGraceMinutes: existingClassDay.autoCloseGraceMinutes,
        }
      : schedule
        ? {
            timezone: schedule.timezone,
            startMinutes: schedule.startMinutes,
            endMinutes: schedule.endMinutes,
            autoOpen: schedule.autoOpen,
            autoCloseGraceMinutes: schedule.autoCloseGraceMinutes,
          }
        : null;

    const timezone = args.timezone ?? fallback?.timezone ?? DEFAULT_TIMEZONE;
    const startMinutes = args.startMinutes ?? fallback?.startMinutes;
    const endMinutes = args.endMinutes ?? fallback?.endMinutes;
    const autoOpen = args.autoOpen ?? fallback?.autoOpen ?? true;
    const autoCloseGraceMinutes =
      args.autoCloseGraceMinutes ?? fallback?.autoCloseGraceMinutes ?? DEFAULT_GRACE_MINUTES;

    if (startMinutes === undefined || endMinutes === undefined) {
      throw new Error("Class day overrides need a start and end time.");
    }

    validateScheduleConfig({
      weekdays: ["monday"],
      startMinutes,
      endMinutes,
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

    if (toUtcTimestamp(classDay.date, classDay.startMinutes, classDay.timezone) > now) {
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
      toUtcTimestamp(classDay.date, classDay.endMinutes, classDay.timezone) +
      classDay.autoCloseGraceMinutes * 60 * 1000;

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
