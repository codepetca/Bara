// @vitest-environment edge-runtime

import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessionLinks from "../lib/session-links";
import { createUniqueStaffShareToken, openAttendanceSession } from "./attendanceEngine";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function seedSession(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    const ownerId = await ctx.db.insert("app_users", {
      displayName: "Token test owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Token test organization",
      slug: "token-test-organization",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const rosterId = await ctx.db.insert("rosters", {
      organizationId,
      createdByAppUserId: ownerId,
      ownerAppUserId: ownerId,
      name: "Token test roster",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("participants", {
      rosterId,
      rawName: "Synthetic Student",
      firstName: "Synthetic",
      lastName: "Student",
      displayName: "Synthetic Student",
      sortKey: "student|synthetic|1",
      participantType: "roster_only",
      linkStatus: "unlinked",
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const existingSessionId = await ctx.db.insert("sessions", {
      rosterId,
      createdByAppUserId: ownerId,
      title: "Existing closed session",
      date: "2026-09-01",
      sessionType: "recurring_class",
      participantMode: "verified",
      status: "closed",
      checkInToken: "existing-student-token",
      staffShareToken: "existing-staff-token",
      createdAt: now,
      updatedAt: now,
    });
    const roster = await ctx.db.get(rosterId);
    if (!roster) throw new Error("Roster fixture was not created.");
    return { roster, ownerId, existingSessionId };
  });
}

describe("session token generation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries collisions with either persisted token namespace when minting a staff link", async () => {
    const t = convexTest(schema, modules);
    await seedSession(t);
    const generate = vi.spyOn(sessionLinks, "createShareToken")
      .mockReturnValueOnce("existing-student-token")
      .mockReturnValueOnce("existing-staff-token")
      .mockReturnValueOnce("fresh-staff-token");

    await expect(t.run((ctx) => createUniqueStaffShareToken(ctx))).resolves.toBe("fresh-staff-token");
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("keeps new session tokens distinct from both namespaces and from each other before insertion", async () => {
    const t = convexTest(schema, modules);
    const { roster, ownerId } = await seedSession(t);
    const generate = vi.spyOn(sessionLinks, "createShareToken")
      .mockReturnValueOnce("existing-staff-token")
      .mockReturnValueOnce("existing-student-token")
      .mockReturnValueOnce("fresh-student-token")
      .mockReturnValueOnce("fresh-student-token")
      .mockReturnValueOnce("existing-staff-token")
      .mockReturnValueOnce("existing-student-token")
      .mockReturnValueOnce("fresh-staff-token");

    const sessionId = await t.run((ctx) => openAttendanceSession(ctx, {
      roster,
      actor: { actorType: "staff", source: "standalone_authkit", appUserId: ownerId },
      date: "2026-09-02",
    }));

    await t.run(async (ctx) => {
      expect(await ctx.db.get(sessionId)).toMatchObject({
        checkInToken: "fresh-student-token",
        staffShareToken: "fresh-staff-token",
      });
      const attendance = await ctx.db.query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();
      expect(attendance).toHaveLength(1);
    });
    expect(generate).toHaveBeenCalledTimes(7);
  });

  it.each(["existing-student-token", "existing-staff-token"])(
    "fails safely after exhausting staff token retries against %s",
    async (collision) => {
      const t = convexTest(schema, modules);
      await seedSession(t);
      const generate = vi.spyOn(sessionLinks, "createShareToken").mockReturnValue(collision);

      await expect(t.run((ctx) => createUniqueStaffShareToken(ctx))).rejects.toThrow(
        "Could not generate staff attendance link. Please try again.",
      );
      expect(generate).toHaveBeenCalledTimes(5);
    },
  );

  it("does not create a session or attendance rows if its staff token keeps matching its new student token", async () => {
    const t = convexTest(schema, modules);
    const { roster, ownerId, existingSessionId } = await seedSession(t);
    const generate = vi.spyOn(sessionLinks, "createShareToken").mockReturnValue("fresh-student-token");

    await expect(t.run((ctx) => openAttendanceSession(ctx, {
      roster,
      actor: { actorType: "staff", source: "standalone_authkit", appUserId: ownerId },
      date: "2026-09-02",
    }))).rejects.toThrow("Could not generate staff attendance link. Please try again.");

    expect(generate).toHaveBeenCalledTimes(6);
    await t.run(async (ctx) => {
      const sessions = await ctx.db.query("sessions").collect();
      expect(sessions.map((session) => session._id)).toEqual([existingSessionId]);
      expect(await ctx.db.query("attendance_records").collect()).toEqual([]);
    });
  });

  it("does not create a session when student token retries all collide with an existing staff token", async () => {
    const t = convexTest(schema, modules);
    const { roster, ownerId, existingSessionId } = await seedSession(t);
    const generate = vi.spyOn(sessionLinks, "createShareToken").mockReturnValue("existing-staff-token");

    await expect(t.run((ctx) => openAttendanceSession(ctx, {
      roster,
      actor: { actorType: "staff", source: "standalone_authkit", appUserId: ownerId },
      date: "2026-09-02",
    }))).rejects.toThrow("Could not generate check-in link. Please try again.");

    expect(generate).toHaveBeenCalledTimes(5);
    await t.run(async (ctx) => {
      const sessions = await ctx.db.query("sessions").collect();
      expect(sessions.map((session) => session._id)).toEqual([existingSessionId]);
      expect(await ctx.db.query("attendance_records").collect()).toEqual([]);
    });
  });
});
