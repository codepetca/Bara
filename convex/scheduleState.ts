import type { Doc, Id } from "./model";
import {
  normalizeWeekdays,
  resolveAutoCloseOffsetMinutes,
  resolveScheduleStartDate,
  type ScheduleConfigInput,
  validateScheduleConfig,
} from "./scheduleConfig";
import { getTodayForTimeZone, listRecurringDates, type Weekday } from "./scheduleHelpers";
import type { MutationCtx, QueryCtx } from "./server";

export async function loadSchedule(ctx: QueryCtx | MutationCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("roster_schedules")
    .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId))
    .unique();
}

export async function loadExternalLink(ctx: QueryCtx | MutationCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("roster_external_links")
    .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId))
    .unique();
}

export async function loadFutureClassDays(
  ctx: QueryCtx | MutationCtx,
  rosterId: Id<"rosters">,
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
    rosterId: Id<"rosters">;
    schedule: Doc<"roster_schedules">;
  },
) {
  const fromDate = getTodayForTimeZone(args.schedule.timezone);
  const scheduleStartDate = resolveScheduleStartDate(args.schedule.timezone, args.schedule.startDate);
  const existingRows = await loadFutureClassDays(ctx, args.rosterId, fromDate);
  const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
  const targetDates = new Set(
    args.schedule.active
      ? listRecurringDates({
          weekdays: args.schedule.weekdays as Weekday[],
          timeZone: args.schedule.timezone,
          startDate: scheduleStartDate,
          endDate: args.schedule.endDate,
        })
      : [],
  );
  const now = Date.now();
  const scheduleAutoCloseOffsetMinutes = resolveAutoCloseOffsetMinutes(args.schedule.autoCloseOffsetMinutes);

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
      row.autoOpenOffsetMinutes !== args.schedule.autoOpenOffsetMinutes ||
      resolveAutoCloseOffsetMinutes(row.autoCloseOffsetMinutes) !== scheduleAutoCloseOffsetMinutes ||
      row.autoCloseGraceMinutes !== args.schedule.autoCloseGraceMinutes
    ) {
      await ctx.db.patch(row._id, {
        timezone: args.schedule.timezone,
        startMinutes: args.schedule.startMinutes,
        endMinutes: args.schedule.endMinutes,
        autoOpen: args.schedule.autoOpen,
        autoOpenOffsetMinutes: args.schedule.autoOpenOffsetMinutes,
        autoCloseOffsetMinutes: scheduleAutoCloseOffsetMinutes,
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
      autoOpenOffsetMinutes: args.schedule.autoOpenOffsetMinutes,
      autoCloseOffsetMinutes: scheduleAutoCloseOffsetMinutes,
      autoCloseGraceMinutes: args.schedule.autoCloseGraceMinutes,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function upsertManagedSchedule(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    config: ScheduleConfigInput;
  },
) {
  const weekdays = normalizeWeekdays(args.config.weekdays as Weekday[]);
  validateScheduleConfig({
    startDate: args.config.startDate,
    endDate: args.config.endDate,
    weekdays,
    startMinutes: args.config.startMinutes,
    endMinutes: args.config.endMinutes,
    autoOpenOffsetMinutes: args.config.autoOpenOffsetMinutes,
    autoCloseOffsetMinutes: args.config.autoCloseOffsetMinutes,
    autoCloseGraceMinutes: args.config.autoCloseGraceMinutes,
  });

  const existingSchedule = await loadSchedule(ctx, args.rosterId);
  const now = Date.now();
  const schedulePatch = {
    startDate: args.config.startDate,
    endDate: args.config.endDate,
    timezone: args.config.timezone,
    weekdays,
    startMinutes: args.config.startMinutes,
    endMinutes: args.config.endMinutes,
    autoOpen: args.config.autoOpen,
    autoOpenOffsetMinutes: args.config.autoOpenOffsetMinutes,
    autoCloseOffsetMinutes: args.config.autoCloseOffsetMinutes,
    autoCloseGraceMinutes: args.config.autoCloseGraceMinutes,
    active: args.config.active,
    updatedAt: now,
  };

  let scheduleId = existingSchedule?._id;
  if (existingSchedule) {
    await ctx.db.patch(existingSchedule._id, schedulePatch);
  } else {
    scheduleId = await ctx.db.insert("roster_schedules", {
      rosterId: args.rosterId,
      createdAt: now,
      ...schedulePatch,
    });
  }

  const nextSchedule = scheduleId ? await ctx.db.get(scheduleId) : null;
  if (!nextSchedule) {
    throw new Error("Could not save the roster schedule.");
  }

  await syncGeneratedClassDays(ctx, {
    rosterId: args.rosterId,
    schedule: nextSchedule,
  });

  return nextSchedule;
}
