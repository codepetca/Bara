// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  applyAttendanceMark,
  closeAttendanceSession,
  openAttendanceSession,
  studentCheckInAttendance,
  type VerifiedActorContext,
} from "./attendanceEngine";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function runEngineJourney(source: "standalone_authkit" | "pika_integration") {
  const t = convexTest(schema, modules);
  return t.run(async (ctx) => {
    const now = Date.parse("2026-09-02T12:50:00Z");
    const teacherId = await ctx.db.insert("app_users", {
      displayName: "Teacher",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const studentId = await ctx.db.insert("app_users", {
      displayName: "Student",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "School",
      slug: `school-${source}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organization_memberships", {
      appUserId: studentId,
      organizationId,
      role: "student",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const rosterId = await ctx.db.insert("rosters", {
      organizationId,
      ownerAppUserId: teacherId,
      createdByAppUserId: teacherId,
      name: "Period 1",
      createdAt: now,
      updatedAt: now,
    });
    const participantId = await ctx.db.insert("participants", {
      rosterId,
      linkedAppUserId: studentId,
      rawName: "Student",
      firstName: "Student",
      lastName: "",
      displayName: "Student",
      sortKey: "|student|one",
      participantType: "identified_user",
      linkStatus: "linked",
      linkMethod: "integration_assertion",
      linkedAt: now,
      linkedByAppUserId: teacherId,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const roster = await ctx.db.get(rosterId);
    if (!roster) throw new Error("Roster setup failed.");

    const staffActor: VerifiedActorContext = {
      actorType: "staff",
      appUserId: teacherId,
      source,
    };
    const sessionId = await openAttendanceSession(ctx, {
      roster,
      actor: staffActor,
      date: "2026-09-02",
      now,
    });
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session setup failed.");
    const studentResult = await studentCheckInAttendance(ctx, {
      session,
      actor: { actorType: "student", appUserId: studentId, source },
      now: now + 1_000,
    });
    const correction = await applyAttendanceMark(ctx, {
      session,
      participantId,
      nextStatus: "late",
      actor: staffActor,
      reasonCode: "teacher_correction",
      now: now + 2_000,
    });
    const finalized = await closeAttendanceSession(ctx, {
      session,
      actor: staffActor,
      now: now + 3_000,
    });
    const closedSession = await ctx.db.get(sessionId);
    if (!closedSession) throw new Error("Closed session was not found.");
    const closedResult = await studentCheckInAttendance(ctx, {
      session: closedSession,
      actor: { actorType: "student", appUserId: studentId, source },
      now: now + 4_000,
    });
    const record = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", sessionId).eq("participantId", participantId),
      )
      .unique();
    return {
      studentResult: {
        code: studentResult.code,
        status: studentResult.attendanceStatus,
        revision: studentResult.recordRevision,
        changed: studentResult.changed,
      },
      correction,
      finalizedCount: finalized.length,
      closedResult: { code: closedResult.code, changed: closedResult.changed },
      record: record && {
        status: record.status,
        revision: record.recordRevision,
        source: record.source,
      },
    };
  });
}

describe("attendance engine adapter equivalence", () => {
  it("applies the same rules and revisions for standalone and Pika verified actors", async () => {
    const standalone = await runEngineJourney("standalone_authkit");
    const integrated = await runEngineJourney("pika_integration");
    expect(integrated).toEqual(standalone);
    expect(standalone).toMatchObject({
      studentResult: { code: "present_marked", status: "present", revision: 1, changed: true },
      correction: { fromStatus: "present", toStatus: "late", recordRevision: 2 },
      finalizedCount: 0,
      closedResult: { code: "session_closed", changed: false },
      record: { status: "late", revision: 2, source: "staff_manual" },
    });
  });
});
