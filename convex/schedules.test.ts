// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { api } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const ownerIdentity = {
  subject: "user_owner_1",
  issuer: "https://api.workos.com/user_management/client_test",
  tokenIdentifier: "https://api.workos.com/user_management/client_test|user_owner_1",
  email: "owner@example.com",
  name: "Owner One",
};
const DEFAULT_START_DATE = "2026-04-06";

function makeStudent(studentId: string, displayName: string) {
  const [firstName, ...rest] = displayName.split(" ");
  const lastName = rest.join(" ");

  return {
    studentId,
    rawName: displayName,
    firstName,
    lastName,
    displayName,
    sortKey: `${lastName.toLocaleLowerCase()}|${firstName.toLocaleLowerCase()}|${studentId}`,
  };
}

async function createRoster() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(ownerIdentity);
  const rosterId = await owner.mutation(api.rosters.importCsv, {
    name: "Grade 10 CS",
    students: [makeStudent("1001", "Alice Able"), makeStudent("1002", "Ben Baker")],
  });

  return { t, owner, rosterId };
}

describe("recurring schedule flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a standalone recurring schedule and generates future class days", async () => {
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
    const { owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday", "wednesday", "friday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.mode).toBe("standalone");
    expect(details?.schedule).toMatchObject({
      startDate: DEFAULT_START_DATE,
      timezone: "America/Toronto",
      weekdays: ["monday", "wednesday", "friday"],
      startMinutes: 490,
      endMinutes: 570,
      autoOpenOffsetMinutes: 5,
      autoCloseOffsetMinutes: 5,
      active: true,
    });
    expect(details?.upcomingClassDays.map((day) => day.date)).toEqual([
      "2026-04-06",
      "2026-04-08",
      "2026-04-10",
      "2026-04-13",
      "2026-04-15",
      "2026-04-17",
    ]);
  });

  it("auto-opens and auto-closes scheduled attendance sessions", async () => {
    vi.setSystemTime(new Date("2026-04-06T11:55:00.000Z"));
    const { t, owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 5,
        active: true,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:06:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    const afterOpen = await owner.query(api.rosters.getById, { rosterId });
    expect(afterOpen?.sessions[0]).toMatchObject({
      date: "2026-04-06",
      status: "open",
    });

    const sessionId = afterOpen?.sessions[0]?._id;
    expect(sessionId).toBeTruthy();

    vi.setSystemTime(new Date("2026-04-06T12:24:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    let exportData = await owner.query(api.attendance.getSessionExport, {
      sessionId: sessionId!,
    });
    expect(exportData?.session.status).toBe("open");

    vi.setSystemTime(new Date("2026-04-06T12:26:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    exportData = await owner.query(api.attendance.getSessionExport, {
      sessionId: sessionId!,
    });
    expect(exportData?.session.status).toBe("closed");
    expect(exportData?.rows.every((row) => row.status === "absent")).toBe(true);
  });

  it("keeps the active class-day record when the schedule is disabled after auto-open", async () => {
    vi.setSystemTime(new Date("2026-04-06T11:55:00.000Z"));
    const { t, owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 5,
        active: true,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:12:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 5,
        active: false,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:40:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    const roster = await owner.query(api.rosters.getById, { rosterId });
    const sessionId = roster?.sessions[0]?._id;
    expect(sessionId).toBeTruthy();

    const exportData = await owner.query(api.attendance.getSessionExport, {
      sessionId: sessionId!,
    });
    expect(exportData?.session.status).toBe("closed");
  });

  it("creates one-off rosters without a managed schedule by default", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);

    const rosterId = await owner.mutation(api.rosters.importCsv, {
      name: "One-Off Attendance",
      students: [makeStudent("2001", "Casey Cole")],
    });

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.schedule).toBeNull();
    expect(details?.upcomingClassDays).toEqual([]);
  });

  it("creates a managed schedule during roster import", async () => {
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);

    const rosterId = await owner.mutation(api.rosters.importCsv, {
      name: "Grade 11 CS",
      students: [makeStudent("3001", "Mina Moss"), makeStudent("3002", "Noah Nash")],
      managedSchedule: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.schedule).toMatchObject({
      startDate: DEFAULT_START_DATE,
      startMinutes: 490,
      endMinutes: 570,
      autoOpenOffsetMinutes: 5,
      autoCloseOffsetMinutes: 5,
      active: true,
    });
    expect(details?.upcomingClassDays.map((day) => day.date)).toEqual([
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
      "2026-04-13",
    ]);
  });

  it("blocks skipping a class day once attendance exists", async () => {
    vi.setSystemTime(new Date("2026-04-06T11:55:00.000Z"));
    const { t, owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 5,
        active: true,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:06:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    await expect(
      owner.mutation(api.schedules.setClassDayOverride, {
        rosterId,
        date: "2026-04-06",
        status: "skipped",
      }),
    ).rejects.toThrow("Attendance already exists for this class day.");
  });

  it("can skip and then restore a scheduled class day before attendance starts", async () => {
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
    const { owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    await owner.mutation(api.schedules.setClassDayOverride, {
      rosterId,
      date: "2026-04-06",
      status: "skipped",
    });

    let details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.upcomingClassDays[0]?.status).toBe("skipped");

    await owner.mutation(api.schedules.setClassDayOverride, {
      rosterId,
      date: "2026-04-06",
      status: "scheduled",
    });

    details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.upcomingClassDays[0]?.status).toBe("scheduled");
  });

  it("does not auto-open restored class-day overrides while recurring is paused", async () => {
    vi.setSystemTime(new Date("2026-04-06T11:55:00.000Z"));
    const { t, owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    await owner.mutation(api.schedules.setClassDayOverride, {
      rosterId,
      date: "2026-04-06",
      status: "skipped",
    });
    await owner.mutation(api.schedules.setClassDayOverride, {
      rosterId,
      date: "2026-04-06",
      status: "scheduled",
    });
    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: false,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:12:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    const roster = await owner.query(api.rosters.getById, { rosterId });
    expect(roster?.sessions).toHaveLength(0);

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.schedule?.active).toBe(false);
    expect(details?.upcomingClassDays[0]).toMatchObject({
      date: "2026-04-06",
      status: "scheduled",
      source: "manual_override",
      linkedSessionStatus: null,
    });
  });

  it("respects schedule start and end dates when generating class days", async () => {
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
    const { owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: "2026-04-08",
        endDate: "2026-04-15",
        timezone: "America/Toronto",
        weekdays: ["monday", "wednesday", "friday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.schedule).toMatchObject({
      startDate: "2026-04-08",
      endDate: "2026-04-15",
    });
    expect(details?.upcomingClassDays.map((day) => day.date)).toEqual([
      "2026-04-08",
      "2026-04-10",
      "2026-04-13",
      "2026-04-15",
    ]);
  });

  it("removes schedule, class-day, and external-link records when deleting a roster", async () => {
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
    const { t, owner, rosterId } = await createRoster();

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        startDate: DEFAULT_START_DATE,
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoOpenOffsetMinutes: 5,
        autoCloseOffsetMinutes: 5,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("roster_external_links", {
        rosterId,
        provider: "pika",
        externalClassroomId: "pika-class-1",
        syncStatus: "linked",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await owner.mutation(api.rosters.remove, { rosterId });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(rosterId)).toBeNull();
      expect(
        await ctx.db.query("roster_schedules").withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId)).collect(),
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("roster_class_days")
          .withIndex("by_rosterId_and_date", (q) => q.eq("rosterId", rosterId))
          .collect(),
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("roster_external_links")
          .withIndex("by_rosterId", (q) => q.eq("rosterId", rosterId))
          .collect(),
      ).toHaveLength(0);
    });
  });
});
