"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import type { ManagedScheduleFormState, ManagedScheduleWeekday } from "@/lib/managed-schedule";
import { managedScheduleWeekdayOptions } from "@/lib/managed-schedule";

type ManagedScheduleFieldsProps = {
  value: ManagedScheduleFormState;
  onChange: (nextValue: ManagedScheduleFormState) => void;
  showActiveToggle?: boolean;
};

function toggleWeekday(weekdays: ManagedScheduleWeekday[], weekday: ManagedScheduleWeekday) {
  if (weekdays.includes(weekday)) {
    return weekdays.filter((value) => value !== weekday);
  }

  return [...weekdays, weekday];
}

export function ManagedScheduleFields({
  value,
  onChange,
  showActiveToggle = true,
}: ManagedScheduleFieldsProps) {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <span className="block font-medium text-slate-900">Start date</span>
          <input
            type="date"
            aria-label="Start date"
            value={value.startDate}
            onChange={(event) => onChange({ ...value, startDate: event.target.value })}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <span className="block font-medium text-slate-900">End date</span>
          <input
            type="date"
            aria-label="End date"
            value={value.endDate}
            onChange={(event) => onChange({ ...value, endDate: event.target.value })}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <span className="block font-medium text-slate-900">Start time</span>
          <input
            type="time"
            aria-label="Start time"
            value={value.startTime}
            onChange={(event) => onChange({ ...value, startTime: event.target.value })}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <span className="block font-medium text-slate-900">End time</span>
          <input
            type="time"
            aria-label="End time"
            value={value.endTime}
            onChange={(event) => onChange({ ...value, endTime: event.target.value })}
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setIsOptionsOpen((current) => !current)}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
        >
          <Settings2 className="h-4 w-4" />
          {isOptionsOpen ? "Hide options" : "Options"}
        </button>

        {isOptionsOpen ? (
          <div className="space-y-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-700">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">Class days</div>
              <div className="flex flex-wrap gap-2">
                {managedScheduleWeekdayOptions.map((option) => {
                  const selected = value.weekdays.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          weekdays: toggleWeekday(value.weekdays, option.value),
                        })
                      }
                      className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                        selected
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-white text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-700">
                <span className="block font-medium text-slate-900">Timezone</span>
                <input
                  value={value.timezone}
                  onChange={(event) => onChange({ ...value, timezone: event.target.value })}
                  className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span className="block font-medium text-slate-900">Close (minutes early)</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  aria-label="Close minutes early"
                  value={value.autoCloseOffsetMinutes}
                  onChange={(event) => onChange({ ...value, autoCloseOffsetMinutes: event.target.value })}
                  className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {showActiveToggle ? (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.active}
                    onChange={(event) => onChange({ ...value, active: event.target.checked })}
                  />
                  <span>Save as active schedule</span>
                </label>
              ) : null}
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.autoOpen}
                  onChange={(event) => onChange({ ...value, autoOpen: event.target.checked })}
                />
                <span>Auto-open attendance</span>
              </label>
              {value.autoOpen ? (
                <label className="inline-flex items-center gap-2">
                  <span>Open</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    aria-label="Open minutes early"
                    value={value.autoOpenOffsetMinutes}
                    onChange={(event) => onChange({ ...value, autoOpenOffsetMinutes: event.target.value })}
                    className="h-9 w-16 rounded-full border border-slate-300 bg-white px-3 text-center text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  />
                  <span>min early</span>
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
