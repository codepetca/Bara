// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { internal } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const ownerIdentity = { subject: "owner", tokenIdentifier: "owner-token", client_id: "client_test_bara", email: "owner@example.com" };
const studentIdentity = { subject: "user_student", tokenIdentifier: "student-token", client_id: "client_test_bara", email: "student@example.edu" };
const browserKey = "browser-key-012345678901234567890123456789";
const student = { studentId: "1001", rawName: "Alice Able", firstName: "Alice", lastName: "Able", displayName: "Alice Able", sortKey: "able|alice|1001" };

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(ownerIdentity);
  const learner = t.withIdentity(studentIdentity);
  const rosterId = await owner.mutation(api.rosters.importCsv, { name: "Class A", students: [student] });
  await t.mutation(internal.roomMemberships.authorize, {
    rosterId, workosUserId: studentIdentity.subject, role: "student", studentId: "1001",
  });
  await learner.mutation(api.appUsers.ensureCurrent, {});
  const roomId = await owner.mutation(api.rooms.create, { rosterId, label: "223" });
  await owner.mutation(api.rooms.setDefault, { rosterId, roomId });
  const credential = await owner.mutation(api.rooms.pairDisplay, { rosterId, roomId });
  const sessionId = await owner.mutation(api.sessions.start, { rosterId, date: "2026-11-09", roomMode: true });
  return { t, owner, learner, rosterId, roomId, credential, sessionId };
}

describe("room QR attendance", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test_bara");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("keeps proofs stable for unchanged windows and invalidates replaced proofs", async () => {
    const { t, owner, rosterId, roomId, credential, sessionId } = await setup();
    await owner.mutation(api.rooms.startCheckIn, { sessionId });
    const first = await t.query(api.rooms.display, { roomId, credential });
    expect(first?.proof).toBeTruthy();
    vi.advanceTimersByTime(5 * 60_000);
    expect((await t.query(api.rooms.display, { roomId, credential, refresh: 1 }))?.proof).toBe(first?.proof);
    const otherRoster = await owner.mutation(api.rosters.importCsv, { name: "Class B", students: [student] });
    await owner.mutation(api.rooms.setDefault, { rosterId: otherRoster, roomId });
    const otherSession = await owner.mutation(api.sessions.start, { rosterId: otherRoster, date: "2026-11-09", roomMode: true });
    await owner.mutation(api.rooms.startCheckIn, { sessionId: otherSession });
    const second = await t.query(api.rooms.display, { roomId, credential });
    expect(second?.proof).not.toBe(first?.proof);
    expect(await t.mutation(api.rooms.beginScan, { roomId, proof: first!.proof!, browserKey })).toBeNull();
    await owner.mutation(api.rooms.stopCheckIn, { sessionId: otherSession });
    const third = await t.query(api.rooms.display, { roomId, credential });
    expect(third?.proof).not.toBe(second?.proof);
    await owner.mutation(api.rooms.startCheckIn, { sessionId: otherSession });
    expect((await t.query(api.rooms.display, { roomId, credential }))?.proof).not.toBe(third?.proof);
    expect(await t.query(api.rooms.display, { roomId, credential: "wrong" })).toBeNull();
    expect(rosterId).toBeTruthy();
  });

  it("checks into matching classes once, preserving manual corrections on retry", async () => {
    const { t, owner, learner, roomId, credential, sessionId } = await setup();
    const rosterB = await owner.mutation(api.rosters.importCsv, { name: "Class B", students: [student] });
    await owner.mutation(api.rooms.setDefault, { rosterId: rosterB, roomId });
    const sessionB = await owner.mutation(api.sessions.start, { rosterId: rosterB, date: "2026-11-09", roomMode: true });
    for (const id of [sessionId, sessionB]) await owner.mutation(api.rooms.startCheckIn, { sessionId: id });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    expect(continuation).toBeTruthy();
    const result = await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey });
    expect(result.status).toBe("complete");
    expect(result.results).toEqual(expect.arrayContaining([{ name: "Class A", code: "present_marked" }, { name: "Class B", code: "present_marked" }]));
    expect(await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey })).toEqual(result);
    const participantId = (await owner.query(api.rosters.getById, { rosterId: rosterB }))!.students[0]!._id;
    await owner.mutation(api.attendance.markManual, { sessionId: sessionB, participantId, nextStatus: "late" });
    const retry = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    await learner.mutation(api.rooms.redeemScan, { roomId, continuation: retry!, browserKey });
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: sessionB }))?.rows[0]?.status).toBe("late");
    await owner.mutation(api.attendance.markManual, { sessionId: sessionB, participantId, nextStatus: "unmarked" });
    const rescan = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: rescan!, browserKey })).results)
      .toContainEqual({ name: "Class B", code: "review_needed" });
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: sessionB }))?.rows[0]?.status).toBe("unmarked");
  });

  it("enforces cutoff and local midnight while retaining prior-day manual editing", async () => {
    const { t, owner, learner, rosterId, roomId, credential, sessionId } = await setup();
    vi.setSystemTime(new Date("2026-11-10T04:59:00Z"));
    await owner.mutation(api.rooms.startCheckIn, { sessionId });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    vi.advanceTimersByTime(60_000);
    expect(await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey })).toBeNull();
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey })).status).toBe("invalid");
    await expect(owner.mutation(api.rooms.startCheckIn, { sessionId })).rejects.toThrow();
    await expect(owner.mutation(api.rooms.moveMeeting, { roomId, sessionId })).rejects.toThrow();
    const tuesday = await owner.mutation(api.sessions.start, { rosterId, date: "2026-11-10", roomMode: true });
    await owner.mutation(api.rooms.startCheckIn, { sessionId: tuesday });
    const fresh = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    expect(fresh).not.toBe(proof);
    const next = await t.mutation(api.rooms.beginScan, { roomId, proof: fresh, browserKey });
    await learner.mutation(api.rooms.redeemScan, { roomId, continuation: next!, browserKey });
    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    await owner.mutation(api.attendance.markManual, { sessionId, participantId, nextStatus: "late" });
    expect((await owner.query(api.attendance.getSessionExport, { sessionId }))?.rows[0]?.status).toBe("late");
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: tuesday }))?.rows[0]?.status).toBe("present");
    await owner.mutation(api.attendance.markManual, { sessionId: tuesday, participantId, nextStatus: "late" });
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: tuesday }))?.rows[0]?.status).toBe("late");
  });

  it("leaves an ambiguous class for review while marking another", async () => {
    const { t, owner, learner, roomId, credential, sessionId } = await setup();
    const rosterB = await owner.mutation(api.rosters.importCsv, { name: "Class B", students: [student] });
    await owner.mutation(api.rooms.setDefault, { rosterId: rosterB, roomId });
    const sessionB = await owner.mutation(api.sessions.start, { rosterId: rosterB, date: "2026-11-09", roomMode: true });
    await t.run(async (ctx) => {
      const original = await ctx.db.query("participants").withIndex("by_rosterId_and_studentId", q => q.eq("rosterId", rosterB).eq("externalId", "1001")).first();
      if (!original) throw new Error("Missing participant");
      const { _id, _creationTime, ...fields } = original;
      void _id; void _creationTime;
      await ctx.db.insert("participants", fields);
    });
    for (const id of [sessionId, sessionB]) await owner.mutation(api.rooms.startCheckIn, { sessionId: id });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    const result = await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey });
    expect(result.results).toEqual(expect.arrayContaining([{ name: "Class A", code: "present_marked" }, { name: "Class B", code: "review_needed" }]));
    expect((await owner.query(api.attendance.getSessionExport, { sessionId }))?.rows[0]?.status).toBe("present");
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: sessionB }))?.rows[0]?.status).toBe("unmarked");
  });

  it("preserves unaffected captured classes through a move and rejects stale undo", async () => {
    const { t, owner, learner, rosterId, roomId, credential, sessionId } = await setup();
    const rosterB = await owner.mutation(api.rosters.importCsv, { name: "Class B", students: [student] });
    await owner.mutation(api.rooms.setDefault, { rosterId: rosterB, roomId });
    const sessionB = await owner.mutation(api.sessions.start, { rosterId: rosterB, date: "2026-11-09", roomMode: true });
    const destination = await owner.mutation(api.rooms.create, { rosterId, label: "220" });
    const destinationCredential = await owner.mutation(api.rooms.pairDisplay, { rosterId, roomId: destination });
    for (const id of [sessionId, sessionB]) await owner.mutation(api.rooms.startCheckIn, { sessionId: id });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    const revision = await owner.mutation(api.rooms.moveMeeting, { roomId: destination, sessionId });
    expect((await t.query(api.rooms.display, { roomId, credential }))?.proof).not.toBe(proof);
    expect((await t.query(api.rooms.display, { roomId: destination, credential: destinationCredential }))?.proof).toBeTruthy();
    await owner.mutation(api.rooms.setDefault, { rosterId, roomId: destination });
    await owner.mutation(api.rooms.undoMove, { sessionId, revision });
    await expect(owner.mutation(api.rooms.undoMove, { sessionId, revision })).rejects.toThrow();
    const result = await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey });
    expect(result.results).toEqual(expect.arrayContaining([{ name: "Class B", code: "present_marked" }]));
    expect((await owner.query(api.attendance.getSessionExport, { sessionId }))?.rows[0]?.status).toBe("unmarked");
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: sessionB }))?.rows[0]?.status).toBe("present");
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    const tomorrow = await owner.mutation(api.sessions.start, { rosterId, date: "2026-11-10", roomMode: true });
    expect((await t.run(ctx => ctx.db.get(tomorrow)))?.roomId).toBe(destination);
  });

  it("rejects a foreign owner, legacy tokens, and Pika room mode", async () => {
    const { t, owner, learner, rosterId, roomId, sessionId } = await setup();
    const foreign = t.withIdentity({ ...ownerIdentity, subject: "foreign", tokenIdentifier: "foreign-token", email: "foreign@example.com" });
    await foreign.mutation(api.rosters.importCsv, { name: "Foreign", students: [student] });
    await expect(foreign.mutation(api.rooms.setDefault, { rosterId, roomId })).rejects.toThrow();
    await expect(foreign.mutation(api.rooms.pairDisplay, { rosterId, roomId })).rejects.toThrow();
    await expect(foreign.mutation(api.rooms.startCheckIn, { sessionId })).rejects.toThrow();
    const session = await owner.query(api.sessions.getByIdForStaff, { sessionId });
    expect((await learner.mutation(api.attendance.studentCheckIn, { token: session!.session.checkInToken })).code).toBe("invalid_token");
    const pikaRoster = await owner.mutation(api.rosters.importCsv, { name: "Pika", students: [student] });
    await t.run(async ctx => {
      const roster = await ctx.db.get(pikaRoster);
      if (!roster) throw new Error("Missing roster");
      await ctx.db.insert("pika_integrated_rosters", { installationRef: "test", rosterRef: "class", rosterId: pikaRoster, ownerAppUserId: roster.ownerAppUserId!, sourceRevision: 1, createdAt: 1, updatedAt: 1 });
    });
    await expect(owner.mutation(api.sessions.start, { rosterId: pikaRoster, date: "2026-11-09", roomMode: true })).rejects.toThrow();
  });


  it("expires a captured window at ten minutes and binds continuation to browser and deadline", async () => {
    const { t, owner, learner, roomId, credential, sessionId } = await setup();
    await owner.mutation(api.rooms.startCheckIn, { sessionId });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey: "another-browser-01234567890123456789012345" })).status).toBe("invalid");
    vi.advanceTimersByTime(2 * 60_000 + 1);
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey })).status).toBe("invalid");
    vi.advanceTimersByTime(7 * 60_000 - 1);
    const nearCutoff = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    expect(nearCutoff).toBeTruthy();
    vi.advanceTimersByTime(60_000);
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: nearCutoff!, browserKey })).status).toBe("invalid");
    expect(await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey })).toBeNull();
  });


  it("does not add a class that opens after scan entry", async () => {
    const { t, owner, learner, roomId, credential, sessionId } = await setup();
    const rosterB = await owner.mutation(api.rosters.importCsv, { name: "Class B", students: [student] });
    await owner.mutation(api.rooms.setDefault, { rosterId: rosterB, roomId });
    const sessionB = await owner.mutation(api.sessions.start, { rosterId: rosterB, date: "2026-11-09", roomMode: true });
    await owner.mutation(api.rooms.startCheckIn, { sessionId });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    await owner.mutation(api.rooms.startCheckIn, { sessionId: sessionB });
    const result = await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey });
    expect(result.results).toEqual([{ name: "Class A", code: "present_marked" }]);
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: sessionB }))?.rows[0]?.status).toBe("unmarked");
  });

  it("revokes the paired display and outstanding scans", async () => {
    const { t, owner, learner, rosterId, roomId, credential, sessionId } = await setup();
    await owner.mutation(api.rooms.startCheckIn, { sessionId });
    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    await owner.mutation(api.rooms.revokeDisplay, { rosterId, roomId });
    expect(await t.query(api.rooms.display, { roomId, credential })).toBeNull();
    expect(await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey })).toBeNull();
    expect((await learner.mutation(api.rooms.redeemScan, { roomId, continuation: continuation!, browserKey })).status).toBe("invalid");
  });

  it("lets a provisioned teacher share a room and requires an explicit dual-role check-in", async () => {
    const { t, owner, rosterId, roomId, credential, sessionId } = await setup();
    const teacherIdentity = { subject: "user_teacher", tokenIdentifier: "teacher-token", client_id: "client_test_bara", email: "teacher@example.com" };
    const teacher = t.withIdentity(teacherIdentity);
    await t.mutation(internal.roomMemberships.authorize, {
      rosterId, workosUserId: teacherIdentity.subject, role: "staff",
    });
    const teacherUser = await teacher.mutation(api.appUsers.ensureCurrent, {});
    expect(teacherUser.defaultOrganization?.role).toBe("staff");

    const ownRoster = await teacher.mutation(api.rosters.importCsv, {
      name: "Class B", students: [{ ...student, studentId: "2001" }],
    });
    await teacher.mutation(api.rooms.setDefault, { rosterId: ownRoster, roomId });
    const ownSession = await teacher.mutation(api.sessions.start, { rosterId: ownRoster, date: "2026-11-09", roomMode: true });
    await teacher.mutation(api.rooms.startCheckIn, { sessionId: ownSession });
    await owner.mutation(api.rooms.startCheckIn, { sessionId });

    const proof = (await t.query(api.rooms.display, { roomId, credential }))!.proof!;
    const continuation = await t.mutation(api.rooms.beginScan, { roomId, proof, browserKey });
    const args = { roomId, continuation: continuation!, browserKey };
    const staffContext = await teacher.query(api.rooms.scanContext, args);
    expect(staffContext?.role).toBe("staff");
    expect(staffContext?.rosters).toEqual([{ rosterId: ownRoster, name: "Class B" }]);
    expect((await teacher.mutation(api.rooms.redeemScan, args)).status).toBe("invalid");

    const participantId = (await owner.query(api.rosters.getById, { rosterId }))!.students[0]!._id;
    await t.mutation(internal.roomMemberships.linkStaffParticipant, {
      participantId, workosUserId: teacherIdentity.subject,
    });
    expect((await teacher.query(api.rooms.scanContext, args))?.role).toBe("both");
    expect((await teacher.mutation(api.rooms.redeemScan, args)).status).toBe("invalid");
    expect(await teacher.mutation(api.rooms.redeemScan, { ...args, asStudent: true })).toEqual({
      status: "complete", results: [{ name: "Class A", code: "present_marked" }],
    });
  });
});
