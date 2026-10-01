// @vitest-environment edge-runtime

import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { autoLinkParticipant } from "./participantLinks";
import schema from "./schema";
import type { Id } from "./model";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workosClientId = "client_test_bara";

const ownerIdentity = {
  subject: "user_owner-1",
  tokenIdentifier: "token-owner-1",
  client_id: workosClientId,
  email: "owner@example.com",
  name: "Owner One",
};

const studentIdentity = {
  subject: "user_student-1",
  tokenIdentifier: "token-student-1",
  client_id: workosClientId,
  email: "student@example.edu",
  name: "Student One",
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

async function createRosterAndOpenSession() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(ownerIdentity);
  const rosterId = await owner.mutation(api.rosters.importCsv, {
    name: "Roster A",
    students: [makeStudent("1001", "Alice Able")],
  });
  const sessionId = await owner.mutation(api.sessions.start, {
    rosterId,
    date: "2026-04-04",
  });
  const roster = await owner.query(api.rosters.getById, { rosterId });

  if (!roster) {
    throw new Error("Expected roster to exist.");
  }

  return {
    t,
    owner,
    rosterId,
    sessionId,
    checkInToken: roster.sessions[0]?.checkInToken ?? "",
  };
}

type CallerOptions = {
  role?: "student" | "staff" | "admin";
  access?: boolean;
  userStatus?: "active" | "disabled";
  membershipStatus?: "active" | "disabled";
  unrelatedOrganization?: boolean;
};

async function createCaller(t: TestConvex<typeof schema>, rosterId: Id<"rosters">, options: CallerOptions = {}) {
  const identity = { ...studentIdentity, subject: `user_${crypto.randomUUID()}`, tokenIdentifier: `token_${crypto.randomUUID()}` };
  const result = await t.run(async (ctx) => {
    const roster = await ctx.db.get(rosterId);
    if (!roster) throw new Error("Expected roster.");
    const now = Date.now();
    const appUserId = await ctx.db.insert("app_users", {
      displayName: "Synthetic caller", status: options.userStatus ?? "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("auth_identities", {
      appUserId, provider: "workos", providerSubject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier, lastSeenAt: now, createdAt: now, updatedAt: now,
    });
    const organizationId = options.unrelatedOrganization
      ? await ctx.db.insert("organizations", { name: "Unrelated", slug: `unrelated-${identity.subject}`, status: "active", createdAt: now, updatedAt: now })
      : roster.organizationId;
    const membershipId = await ctx.db.insert("organization_memberships", {
      appUserId, organizationId, role: options.role ?? "staff", status: options.membershipStatus ?? "active",
      studentId: "1001", createdAt: now, updatedAt: now,
    });
    if (options.access ?? true) await ctx.db.insert("roster_access", {
      rosterId, membershipId, accessRole: "staff", createdAt: now, updatedAt: now,
    });
    return { appUserId, membershipId, organizationId };
  });
  return { caller: t.withIdentity(identity), ...result };
}

async function attendanceSnapshot(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ({
    records: await ctx.db.query("attendance_records").collect(),
    events: await ctx.db.query("attendance_events").collect(),
    participants: await ctx.db.query("participants").collect(),
    sessions: await ctx.db.query("sessions").collect(),
  }));
}

describe("verified QR attendance flow", () => {
  beforeEach(() => vi.stubEnv("WORKOS_CLIENT_ID", workosClientId));
  afterEach(() => vi.unstubAllEnvs());

  it("starts sessions with unmarked attendance and closes them to absent", async () => {
    const { t, sessionId } = await createRosterAndOpenSession();

    await t.run(async (ctx) => {
      const attendanceRows = await ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();

      expect(attendanceRows).toHaveLength(1);
      expect(attendanceRows[0]?.status).toBe("unmarked");
    });

    const owner = t.withIdentity(ownerIdentity);
    await owner.mutation(api.sessions.close, { sessionId });

    await t.run(async (ctx) => {
      const attendanceRows = await ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();

      expect(attendanceRows[0]?.status).toBe("absent");
      expect(attendanceRows[0]?.source).toBe("system_finalize");
    });
  });

  it("marks a uniquely matched student present on self check-in", async () => {
    const { t, owner, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        schoolEmail: "student@example.edu",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "green",
      code: "present_marked",
      attendanceStatus: "present",
      student: {
        displayName: "Alice Able",
        studentId: "1001",
      },
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "present",
      present: true,
    });
  });

  it("returns a duplicate result for a repeated student scan", async () => {
    const { t, rosterId, checkInToken } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    const duplicateResult = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(duplicateResult).toMatchObject({
      tone: "yellow",
      code: "already_present",
      attendanceStatus: "present",
      student: {
        displayName: "Alice Able",
        studentId: "1001",
      },
    });
  });

  it("lets staff mark late and then reset back to unmarked", async () => {
    const { owner, rosterId, sessionId } = await createRosterAndOpenSession();
    const roster = await owner.query(api.rosters.getById, { rosterId });
    if (!roster) {
      throw new Error("Expected roster.");
    }

    const participantId = roster.students[0]!._id;

    await owner.mutation(api.attendance.markManual, {
      sessionId,
      participantId,
      nextStatus: "late",
    });

    await owner.mutation(api.attendance.markManual, {
      sessionId,
      participantId,
      nextStatus: "unmarked",
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "unmarked",
      present: false,
    });
  });

  it.each(["staff", "admin"] as const)("allows authorized %s token editing and attributes the authenticated actor", async (role) => {
    const { t, owner, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const { caller, appUserId } = await createCaller(t, rosterId, { role });
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const rows = await caller.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken });
    expect(rows?.session._id).toBe(sessionId);
    expect(rows?.rows[0]?.participantId).toBe(participantId);
    await caller.mutation(api.attendance.markManualByToken, { token: checkInToken, participantId, nextStatus: "present" });
    expect((await owner.query(api.attendance.getSessionExport, { sessionId }))?.rows[0]).toMatchObject({
      studentId: "1001", status: "present", present: true,
    });
    await t.run(async (ctx) => {
      const event = await ctx.db.query("attendance_events")
        .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", sessionId).eq("result", "applied")).first();
      expect(event).toMatchObject({ actorType: "staff", actorAppUserId: appUserId, eventType: "manual_mark" });
      const record = await ctx.db.query("attendance_records").withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId)).first();
      expect(record?.modifiedByAppUserId).toBe(appUserId);
    });
    await expect(caller.query(api.attendance.getDisplayCounts, { sessionId })).resolves.toEqual({
      counts: { total: 1, present: 1, late: 0, unmarked: 0, absent: 0 },
    });
  });

  it.each([
    ["student with stale staff roster access", { role: "student" }],
    ["staff without roster access", { access: false }],
    ["unrelated staff with a stale access row", { unrelatedOrganization: true }],
    ["disabled user", { userStatus: "disabled" }],
    ["disabled membership", { membershipStatus: "disabled" }],
  ] as const)("denies token roster reads and manual writes for %s", async (_label, options) => {
    const { t, owner, rosterId, checkInToken } = await createRosterAndOpenSession();
    const { caller } = await createCaller(t, rosterId, options);
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).resolves.toBeNull();
    await expect(caller.mutation(api.attendance.markManualByToken, {
      token: checkInToken, participantId, nextStatus: "present",
    })).rejects.toThrow("Unauthorized");
    expect(await attendanceSnapshot(t)).toEqual(before);
  });

  it("denies anonymous and uninitialized callers even when they possess the student QR", async () => {
    const { t, owner, rosterId, sessionId, checkInToken } = await createRosterAndOpenSession();
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    for (const caller of [t, t.withIdentity(studentIdentity)]) {
      await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).resolves.toBeNull();
      await expect(caller.mutation(api.attendance.markManualByToken, {
        token: checkInToken, participantId, nextStatus: "present",
      })).rejects.toThrow("Unauthorized");
      await expect(caller.query(api.attendance.getDisplayCounts, { sessionId })).rejects.toThrow();
    }
    const invalidClient = t.withIdentity({ ...ownerIdentity, client_id: "wrong_client" });
    await expect(invalidClient.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).rejects.toThrow("Not authenticated.");
    await expect(invalidClient.mutation(api.attendance.markManualByToken, {
      token: checkInToken, participantId, nextStatus: "present",
    })).rejects.toThrow("Not authenticated.");
    expect(await attendanceSnapshot(t)).toEqual(before);
    await expect(t.query(api.sessions.getCheckInContext, { token: checkInToken })).resolves.not.toBeNull();
  });

  it("denies disabled organizations even to staff with roster access", async () => {
    const { t, owner, rosterId, sessionId, checkInToken } = await createRosterAndOpenSession();
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const { caller, organizationId } = await createCaller(t, rosterId);
    await t.run((ctx) => ctx.db.patch(organizationId, { status: "disabled" }));
    const before = await attendanceSnapshot(t);
    await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).resolves.toBeNull();
    await expect(caller.mutation(api.attendance.markManualByToken, { token: checkInToken, participantId, nextStatus: "present" })).rejects.toThrow("Unauthorized");
    await expect(caller.query(api.attendance.getLiveSessionRows, { sessionId })).rejects.toThrow();
    await expect(caller.query(api.attendance.getDisplayCounts, { sessionId })).rejects.toThrow();
    expect(await attendanceSnapshot(t)).toEqual(before);
  });

  it("enforces staff roles on ID-based roster and session reads and writes despite stale roster access", async () => {
    const { t, owner, rosterId, sessionId } = await createRosterAndOpenSession();
    const { caller } = await createCaller(t, rosterId, { role: "student" });
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    await expect(caller.query(api.rosters.getById, { rosterId })).resolves.toBeNull();
    await expect(caller.query(api.rosters.list, {})).resolves.toEqual([]);
    await expect(caller.query(api.attendance.getSessionExport, { sessionId })).resolves.toBeNull();
    for (const read of [
      () => caller.query(api.sessions.getByIdForStaff, { sessionId }),
      () => caller.query(api.sessions.getActiveForRoster, { rosterId }),
      () => caller.query(api.sessions.getDisplayContext, { sessionId }),
      () => caller.query(api.attendance.getLiveSessionRows, { sessionId }),
      () => caller.query(api.attendance.getDisplayCounts, { sessionId }),
    ]) await expect(read()).rejects.toThrow("Unauthorized");
    for (const write of [
      () => caller.mutation(api.attendance.markManual, { sessionId, participantId, nextStatus: "present" }),
      () => caller.mutation(api.sessions.close, { sessionId }),
      () => caller.mutation(api.sessions.start, { rosterId, date: "2026-04-05" }),
      () => caller.mutation(api.rosters.rename, { rosterId, name: "Unauthorized rename" }),
    ]) await expect(write()).rejects.toThrow("Unauthorized");
    expect(await attendanceSnapshot(t)).toEqual(before);
  });

  it("retains stored staff tokens as inert compatibility data", async () => {
    const { t, owner, rosterId, sessionId, checkInToken } = await createRosterAndOpenSession();
    const legacyStaffToken = "legacy-staff-token-synthetic";
    await t.run((ctx) => ctx.db.patch(sessionId, { staffShareToken: legacyStaffToken }));
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    for (const caller of [t, owner]) {
      await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token: legacyStaffToken })).resolves.toBeNull();
      await expect(caller.query(api.attendance.getDisplayCountsByToken, { token: legacyStaffToken })).resolves.toBeNull();
      await expect(caller.query(api.sessions.getDisplayContextByToken, { token: legacyStaffToken })).resolves.toBeNull();
      await expect(caller.mutation(api.attendance.markManualByToken, { token: legacyStaffToken, participantId, nextStatus: "present" })).rejects.toThrow();
    }
    await expect(t.query(api.sessions.getCheckInContext, { token: legacyStaffToken })).resolves.toBeNull();
    await expect(t.withIdentity(studentIdentity).mutation(api.attendance.studentCheckIn, { token: legacyStaffToken })).resolves.toMatchObject({ code: "invalid_token" });
    expect(await attendanceSnapshot(t)).toEqual(before);
    await expect(owner.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).resolves.not.toBeNull();
  });

  it("returns null reads and rejects writes for unknown tokens without changing attendance", async () => {
    const { t, owner, rosterId } = await createRosterAndOpenSession();
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    for (const token of ["", "unknown-synthetic-token"]) {
      for (const caller of [t, owner]) {
        await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token })).resolves.toBeNull();
        await expect(caller.query(api.attendance.getDisplayCountsByToken, { token })).resolves.toBeNull();
        await expect(caller.query(api.sessions.getDisplayContextByToken, { token })).resolves.toBeNull();
        await expect(caller.mutation(api.attendance.markManualByToken, { token, participantId, nextStatus: "present" })).rejects.toThrow();
      }
    }
    expect(await attendanceSnapshot(t)).toEqual(before);
  });

  it("rejects cross-roster participants even for authorized token editors", async () => {
    const { t, owner, checkInToken } = await createRosterAndOpenSession();
    const otherRosterId = await owner.mutation(api.rosters.importCsv, { name: "Other roster", students: [makeStudent("2002", "Bob Baker")] });
    const participantId = (await owner.query(api.rosters.getById, { rosterId: otherRosterId }))!.students[0]!._id;
    const before = await attendanceSnapshot(t);
    await expect(owner.mutation(api.attendance.markManualByToken, { token: checkInToken, participantId, nextStatus: "present" })).rejects.toThrow("Student not found in this session.");
    expect(await attendanceSnapshot(t)).toEqual(before);
  });

  it("closes token editors and writes while preserving authorized ID-based history and public counts", async () => {
    const { t, owner, rosterId, sessionId, checkInToken } = await createRosterAndOpenSession();
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    await owner.mutation(api.sessions.close, { sessionId });
    const before = await attendanceSnapshot(t);
    for (const caller of [t, owner]) await expect(caller.query(api.attendance.getLiveSessionRowsByToken, { token: checkInToken })).resolves.toBeNull();
    await expect(owner.mutation(api.attendance.markManualByToken, { token: checkInToken, participantId, nextStatus: "present" })).rejects.toThrow("This session is closed.");
    await expect(owner.mutation(api.attendance.markManual, { sessionId, participantId, nextStatus: "present" })).rejects.toThrow("This session is closed.");
    expect(await attendanceSnapshot(t)).toEqual(before);
    const history = await owner.query(api.attendance.getLiveSessionRows, { sessionId });
    expect(history?.rows).toHaveLength(1);
    expect(history?.session.status).toBe("closed");
    await expect(t.query(api.attendance.getDisplayCountsByToken, { token: checkInToken })).resolves.toEqual({
      counts: { total: 1, present: 0, late: 0, unmarked: 0, absent: 1 },
    });
    await expect(owner.query(api.attendance.getDisplayCounts, { sessionId })).resolves.toEqual({
      counts: { total: 1, present: 0, late: 0, unmarked: 0, absent: 1 },
    });
    await expect(t.query(api.sessions.getDisplayContextByToken, { token: checkInToken })).resolves.toMatchObject({ checkInToken, status: "closed" });
  });

  it("exposes only public display context and counts to holders of the student QR", async () => {
    const { t, owner, sessionId, checkInToken } = await createRosterAndOpenSession();
    const display = await t.query(api.attendance.getDisplayCountsByToken, { token: checkInToken });
    expect(display).toEqual({ counts: { total: 1, present: 0, late: 0, unmarked: 1, absent: 0 } });
    expect(await owner.query(api.attendance.getDisplayCounts, { sessionId })).toEqual(display);
    const context = await t.query(api.sessions.getDisplayContextByToken, { token: checkInToken });
    expect(context).toMatchObject({ title: "Roster A", rosterName: "Roster A", checkInToken, status: "open" });
    for (const payload of [display, context]) {
      const serialized = JSON.stringify(payload);
      for (const privateValue of ["1001", "Alice Able", "student@example.edu", "participantId", "students", "rows"]) expect(serialized).not.toContain(privateValue);
    }
    expect(Object.keys(display ?? {})).toEqual(["counts"]);
  });

  it("blocks unmatched students and records the failed attempt", async () => {
    const { t, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "9999",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "red",
      code: "not_on_roster",
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("attendance_events")
        .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", sessionId).eq("result", "blocked"))
        .collect();

      expect(events).toHaveLength(1);
      expect(events[0]?.reasonCode).toBe("not_on_roster");
    });
  });

  it("ignores inactive linked participants during self check-in", async () => {
    const { t, owner, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});
    const ownerAppUser = await owner.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });

      const activeParticipant = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_and_studentId", (q) => q.eq("rosterId", rosterId).eq("externalId", "1001"))
        .unique();

      if (!activeParticipant) {
        throw new Error("Expected active participant.");
      }

      await ctx.db.insert("participants", {
        rosterId,
        linkedAppUserId: currentStudent._id,
        externalId: "1001-old",
        schoolEmail: "old@example.edu",
        rawName: "Student One",
        firstName: "Student",
        lastName: "One",
        displayName: "Student One",
        sortKey: "one|student|1001-old",
        participantType: "identified_user",
        linkStatus: "linked",
        linkMethod: "manual_staff",
        linkedAt: 1,
        linkedByAppUserId: ownerAppUser._id,
        active: false,
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.patch(activeParticipant._id, {
        linkedAppUserId: undefined,
        participantType: "roster_only",
        linkStatus: "unlinked",
        linkMethod: undefined,
        linkedAt: undefined,
        linkedByAppUserId: undefined,
        updatedAt: 2,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "green",
      code: "present_marked",
      attendanceStatus: "present",
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "present",
      present: true,
    });
  });

  it("accepts email-only roster imports", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);

    const rosterId = await owner.mutation(api.rosters.importCsv, {
      name: "Email Roster",
      students: [
        {
          studentId: undefined,
          schoolEmail: "student@example.edu",
          rawName: "Student One",
          firstName: "Student",
          lastName: "One",
          displayName: "Student One",
          sortKey: "one|student|student@example.edu",
        },
      ],
    });

    const roster = await owner.query(api.rosters.getById, { rosterId });
    expect(roster?.students[0]).toMatchObject({
      studentId: "",
      schoolEmail: "student@example.edu",
    });
  });

  it("clears stale auto-links when roster identifiers no longer resolve cleanly", async () => {
    const { t, owner, rosterId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});
    const ownerAppUser = await owner.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });

      const participant = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_and_studentId", (q) => q.eq("rosterId", rosterId).eq("externalId", "1001"))
        .unique();

      if (!participant) {
        throw new Error("Expected participant.");
      }

      await ctx.db.patch(participant._id, {
        linkedAppUserId: currentStudent._id,
        participantType: "identified_user",
        linkStatus: "linked",
        linkMethod: "student_id",
        linkedAt: 1,
        linkedByAppUserId: ownerAppUser._id,
        externalId: "9999",
        schoolEmail: undefined,
        updatedAt: 2,
      });

      const refreshedParticipant = await ctx.db.get(participant._id);
      if (!refreshedParticipant) {
        throw new Error("Expected refreshed participant.");
      }

      await autoLinkParticipant(ctx, roster, refreshedParticipant, ownerAppUser._id);
    });

    await t.run(async (ctx) => {
      const participants = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
        .collect();
      const participant = participants.find((entry) => entry.externalId === "9999");

      expect(participant?.linkedAppUserId).toBeUndefined();
      expect(participant?.linkStatus).toBe("review_needed");
    });
  });

  it("keeps deactivated participants visible in an open session after roster re-import", async () => {
    const { owner, rosterId, sessionId } = await createRosterAndOpenSession();

    await owner.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1002", "Baker, Jamie")],
      deactivateMissing: true,
    });

    const liveSession = await owner.query(api.attendance.getLiveSessionRows, { sessionId });

    expect(liveSession?.rows.map((row) => row.studentId)).toEqual(["1001", "1002"]);
    expect(liveSession?.counts.total).toBe(2);
    expect(liveSession?.counts.unmarked).toBe(2);
  });
});
