export type ManagedScheduleWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ManagedScheduleFormState = {
  startDate: string;
  endDate: string;
  timezone: string;
  weekdays: ManagedScheduleWeekday[];
  startTime: string;
  endTime: string;
  autoOpen: boolean;
  autoOpenOffsetMinutes: string;
  autoCloseOffsetMinutes: string;
  autoCloseGraceMinutes: string;
  active: boolean;
};

export const MANAGED_SCHEDULE_DEFAULT_TIMEZONE = "America/Toronto";
export const MANAGED_SCHEDULE_DEFAULT_AUTO_OPEN_OFFSET_MINUTES = 5;
export const MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_OFFSET_MINUTES = 5;
export const MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_GRACE_MINUTES = 10;

export const managedScheduleWeekdayOptions: Array<{ value: ManagedScheduleWeekday; label: string }> = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

export const managedScheduleDefaultWeekdays: ManagedScheduleWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export const MANAGED_SCHEDULE_DEFAULT_START_TIME = "08:10";
export const MANAGED_SCHEDULE_DEFAULT_END_TIME = "09:30";

export function getTodayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNextDateString(now = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  return getTodayDateString(next);
}

export function createDefaultManagedScheduleForm(startDate = getTodayDateString()): ManagedScheduleFormState {
  return {
    startDate,
    endDate: getNextDateString(new Date(`${startDate}T12:00:00`)),
    timezone: MANAGED_SCHEDULE_DEFAULT_TIMEZONE,
    weekdays: managedScheduleDefaultWeekdays,
    startTime: MANAGED_SCHEDULE_DEFAULT_START_TIME,
    endTime: MANAGED_SCHEDULE_DEFAULT_END_TIME,
    autoOpen: true,
    autoOpenOffsetMinutes: String(MANAGED_SCHEDULE_DEFAULT_AUTO_OPEN_OFFSET_MINUTES),
    autoCloseOffsetMinutes: String(MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_OFFSET_MINUTES),
    autoCloseGraceMinutes: String(MANAGED_SCHEDULE_DEFAULT_AUTO_CLOSE_GRACE_MINUTES),
    active: true,
  };
}

export const defaultManagedScheduleForm = createDefaultManagedScheduleForm();

export function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error("Use a valid time.");
  }

  return hours * 60 + minutes;
}

export function formatMinutes(value: number) {
  return minutesToTime(value);
}

export function formatWeekdays(weekdays: ManagedScheduleWeekday[]) {
  const labels = managedScheduleWeekdayOptions
    .filter((option) => weekdays.includes(option.value))
    .map((option) => option.label);
  return labels.length > 0 ? labels.join(" · ") : "No class days";
}
