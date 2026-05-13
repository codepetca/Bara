import { v } from "convex/values";
import {
  MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_OFFSET_MINUTES,
  MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_GRACE_MINUTES,
  MANAGED_SCHEDULE_DEFAULT_AUTO_OPEN_OFFSET_MINUTES,
  MANAGED_SCHEDULE_DEFAULT_TIMEZONE,
} from "../lib/managed-schedule";
import { getTodayForTimeZone, weekdayValues, type Weekday } from "./scheduleHelpers";

export const DEFAULT_TIMEZONE = MANAGED_SCHEDULE_DEFAULT_TIMEZONE;
export const DEFAULT_GRACE_MINUTES = MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_GRACE_MINUTES;
export const DEFAULT_AUTO_OPEN_OFFSET_MINUTES = MANAGED_SCHEDULE_DEFAULT_AUTO_OPEN_OFFSET_MINUTES;
export const DEFAULT_AUTO_CLOSE_OFFSET_MINUTES = MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_OFFSET_MINUTES;

export const weekdayValidator = v.union(
  v.literal("monday"),
  v.literal("tuesday"),
  v.literal("wednesday"),
  v.literal("thursday"),
  v.literal("friday"),
  v.literal("saturday"),
  v.literal("sunday"),
);

export const scheduleConfigValidator = v.object({
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
});

export type ScheduleConfigInput = {
  startDate: string;
  endDate?: string;
  timezone: string;
  weekdays: Weekday[];
  startMinutes: number;
  endMinutes: number;
  autoOpen: boolean;
  autoOpenOffsetMinutes: number;
  autoCloseOffsetMinutes: number;
  autoCloseGraceMinutes: number;
  active: boolean;
};

export function normalizeWeekdays(weekdays: Weekday[]) {
  const deduped = [...new Set(weekdays)];
  return weekdayValues.filter((weekday) => deduped.includes(weekday));
}

export function validateScheduleConfig(config: {
  startDate: string;
  endDate?: string;
  weekdays: Weekday[];
  startMinutes: number;
  endMinutes: number;
  autoOpenOffsetMinutes: number;
  autoCloseOffsetMinutes: number;
  autoCloseGraceMinutes: number;
}) {
  if (config.startMinutes < 0 || config.startMinutes >= 24 * 60) {
    throw new Error("Start time must be within the day.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate)) {
    throw new Error("Start date must be a valid date.");
  }

  if (config.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(config.endDate)) {
    throw new Error("End date must be a valid date.");
  }

  if (config.endDate && config.endDate < config.startDate) {
    throw new Error("End date must be on or after the start date.");
  }

  if (config.endMinutes <= config.startMinutes || config.endMinutes > 24 * 60) {
    throw new Error("End time must be after the start time.");
  }

  if (config.autoOpenOffsetMinutes < 0 || config.autoOpenOffsetMinutes > 30) {
    throw new Error("Auto-open must be between 0 and 30 minutes before class.");
  }

  if (config.autoCloseOffsetMinutes < 0 || config.autoCloseOffsetMinutes > 30) {
    throw new Error("Close-early time must be between 0 and 30 minutes.");
  }

  if (config.endMinutes - config.startMinutes <= config.autoCloseOffsetMinutes) {
    throw new Error("Close-early time must be shorter than the class length.");
  }

  if (config.autoCloseGraceMinutes < 0 || config.autoCloseGraceMinutes > 180) {
    throw new Error("Grace time must be between 0 and 180 minutes.");
  }

  if (config.weekdays.length === 0) {
    throw new Error("Pick at least one class day.");
  }
}

export function resolveAutoCloseOffsetMinutes(value?: number) {
  return value ?? DEFAULT_AUTO_CLOSE_OFFSET_MINUTES;
}

export function resolveScheduleStartDate(timezone: string, startDate?: string) {
  return startDate ?? getTodayForTimeZone(timezone);
}
