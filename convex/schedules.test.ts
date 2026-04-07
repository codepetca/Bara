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
  subject: "clerk|owner-1",
  tokenIdentifier: "token-owner-1",
  email: "owner@example.com",
  name: "Owner One",
};

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
        timezone: "America/Toronto",
        weekdays: ["monday", "wednesday", "friday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 9 * 60 + 30,
        autoOpen: true,
        autoCloseGraceMinutes: 10,
        active: true,
      },
    });

    const details = await owner.query(api.schedules.getForRoster, { rosterId });
    expect(details?.mode).toBe("standalone");
    expect(details?.schedule).toMatchObject({
      timezone: "America/Toronto",
      weekdays: ["monday", "wednesday", "friday"],
      startMinutes: 490,
      endMinutes: 570,
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
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoCloseGraceMinutes: 5,
        active: true,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:12:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    const afterOpen = await owner.query(api.rosters.getById, { rosterId });
    expect(afterOpen?.sessions[0]).toMatchObject({
      date: "2026-04-06",
      status: "open",
    });

    vi.setSystemTime(new Date("2026-04-06T12:40:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    const sessionId = afterOpen?.sessions[0]?._id;
    expect(sessionId).toBeTruthy();

    const exportData = await owner.query(api.attendance.getSessionExport, {
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
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
        autoCloseGraceMinutes: 5,
        active: true,
      },
    });

    vi.setSystemTime(new Date("2026-04-06T12:12:00.000Z"));
    await t.mutation(internal.schedules.runAutomation, {});

    await owner.mutation(api.schedules.upsertForRoster, {
      rosterId,
      config: {
        timezone: "America/Toronto",
        weekdays: ["monday"],
        startMinutes: 8 * 60 + 10,
        endMinutes: 8 * 60 + 30,
        autoOpen: true,
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
});
