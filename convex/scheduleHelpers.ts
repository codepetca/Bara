const DAY_MS = 24 * 60 * 60 * 1000;

export const weekdayValues = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof weekdayValues)[number];

const weekdayMap: Record<string, Weekday> = {
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
};

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
    weekday: weekdayMap[values.get("weekday") ?? "Monday"] ?? "monday",
  };
}

function formatDateParts(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTodayForTimeZone(timeZone: string, now = new Date()) {
  return formatDateParts(getLocalParts(now, timeZone));
}

export function getDateStringForTimeZone(date: Date, timeZone: string) {
  return formatDateParts(getLocalParts(date, timeZone));
}

export function getWeekdayForTimeZone(date: Date, timeZone: string): Weekday {
  return getLocalParts(date, timeZone).weekday;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

export function toUtcTimestamp(date: string, minutesInDay: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;

  let utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute, 0, 0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utc), timeZone);
    utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute, 0, 0) - offset;
  }

  return utc;
}

export function listRecurringDates(args: {
  weekdays: Weekday[];
  timeZone: string;
  startDate?: string;
  endDate?: string;
  horizonDays?: number;
  now?: Date;
}) {
  const horizonDays = args.horizonDays ?? 90;
  const start = new Date(args.now ?? Date.now());
  start.setUTCHours(12, 0, 0, 0);

  const targetWeekdays = new Set(args.weekdays);
  const seen = new Set<string>();
  const dates: string[] = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const candidate = new Date(start.getTime() + offset * DAY_MS);
    const localDate = getDateStringForTimeZone(candidate, args.timeZone);
    if (seen.has(localDate)) {
      continue;
    }

    seen.add(localDate);
    if (args.startDate && localDate < args.startDate) {
      continue;
    }
    if (args.endDate && localDate > args.endDate) {
      continue;
    }
    if (targetWeekdays.has(getWeekdayForTimeZone(candidate, args.timeZone))) {
      dates.push(localDate);
    }
  }

  return dates;
}

export function getCandidateAutomationDates(now = new Date()) {
  const base = new Date(now);
  base.setUTCHours(12, 0, 0, 0);

  return [-1, 0, 1].map((offset) => {
    const candidate = new Date(base.getTime() + offset * DAY_MS);
    return candidate.toISOString().slice(0, 10);
  });
}
