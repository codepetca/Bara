const dateOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
} as const;
const calendarFormatter = new Intl.DateTimeFormat("en-US", { ...dateOptions, timeZone: "UTC" });
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  ...dateOptions,
  timeZone: "America/Toronto",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

export function formatCalendarDate(date: string) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return date;
  const { weekday, month, day, year } = formattedParts(calendarFormatter, timestamp);
  return `${weekday} ${month} ${day}, ${year}`;
}

export function formatTimestamp(timestamp: number) {
  const { weekday, month, day, year, hour, minute, second, dayPeriod } = formattedParts(timestampFormatter, timestamp);
  return `${weekday} ${month} ${day}, ${year} · ${hour}:${minute}:${second} ${dayPeriod}`;
}

function formattedParts(formatter: Intl.DateTimeFormat, timestamp: number) {
  return Object.fromEntries(formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
}
