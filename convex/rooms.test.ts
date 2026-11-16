// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { createV1RequestSignature, sha256Hex } from "../lib/attendance-contract/v1/signing";
import { displayPairingBeginPath, displayPairingLifetime, displayPairingNetworkLimit } from "../lib/display-pairing";
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
const pairingSecret = "test-only-standalone-display-pairing-secret";

async function signedPairing(credential: string, source = "0".repeat(64)) {
  const credentialHash = await sha256Hex(credential);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret: pairingSecret, method: "POST", path: displayPairingBeginPath, timestamp, nonce: source, body: credentialHash,
  });
  return { credentialHash, source, timestamp, signature };
}

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
    vi.stubEnv("BARA_DISPLAY_PAIRING_SECRET", pairingSecret);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("pairs an anonymous receiver from an authorized Bara room without giving students room access", async () => {
    const { t, owner, learner, roomId, rosterId, credential: previousCredential } = await setup();
    const credential = "S".repeat(40);
    const args = await signedPairing(credential);
    expect(await t.mutation(api.displayPairing.begin, args)).toBe("ready");
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected a pairing code");
    expect(await t.mutation(api.displayPairing.begin, args)).toBe("ready");
    expect(await t.query(api.displayPairing.status, { credential })).toEqual(waiting);
    const claim = { rosterId, roomId, code: waiting.code };
    await expect(learner.mutation(api.rooms.pairDisplayByCode, claim)).rejects.toThrow();
    expect(await owner.mutation(api.rooms.pairDisplayByCode, claim)).toBe("paired");
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "paired", roomId });
    expect(await t.query(api.rooms.display, { roomId, credential: previousCredential })).toBeNull();
    expect(await t.query(api.rooms.display, { roomId, credential })).toMatchObject({ label: "223", proof: null });
  });

  it("requires signed issuance and limits a network without preventing another from pairing", async () => {
    const t = convexTest(schema, modules);
    const first = await signedPairing("0".repeat(40));
    expect(await t.mutation(api.displayPairing.begin, { ...first, source: "1".repeat(64) })).toBe("forbidden");
    expect(await t.mutation(api.displayPairing.begin, { ...first, credentialHash: "f".repeat(64) })).toBe("forbidden");
    vi.advanceTimersByTime(30_000);
    expect(await t.mutation(api.displayPairing.begin, first)).toBe("forbidden");

    for (let i = 0; i < displayPairingNetworkLimit; i++) {
      const args = await signedPairing(String(i).padStart(40, "0"));
      expect(await t.mutation(api.displayPairing.begin, args)).toBe("ready");
    }
    const another = "A".repeat(40);
    expect(await t.mutation(api.displayPairing.begin, await signedPairing(another))).toBe("rate_limited");
    expect(await t.mutation(api.displayPairing.begin, await signedPairing(another, "1".repeat(64)))).toBe("ready");
    expect(await t.query(api.displayPairing.status, { credential: another })).toMatchObject({ state: "waiting" });
    expect(await t.mutation(api.displayPairing.begin, await signedPairing("0".repeat(40)))).toBe("ready");
    vi.setSystemTime(Date.now() + displayPairingLifetime);
    expect(await t.mutation(api.displayPairing.begin, await signedPairing("B".repeat(40)))).toBe("ready");
  });

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

describe("display fleet", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test_bara");
    vi.stubEnv("BARA_DISPLAY_PAIRING_SECRET", pairingSecret);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("lets the display organization administrator update its name and type in place", async () => {
    const { t, owner, learner } = await setup();
    const organizationId = (await owner.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const credential = "N".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected a pairing code");
    const { deviceId } = await owner.mutation(api.displayPairing.register, {
      organizationId, code: waiting.code, label: "Pilot iPad", platform: "ipad", roomId: null, newRoomName: "Lab",
    });
    if (!deviceId) throw new Error("Expected a registered display");
    const before = await t.query(api.displayPairing.status, { credential });
    if (before.state !== "paired") throw new Error("Expected an assigned display");
    const roomId = before.roomId;
    const args = { organizationId, deviceId, label: " Hall   display ", platform: "other" as const };
    await expect(learner.mutation(api.displayPairing.updateDisplay, args)).rejects.toThrow("administrator");
    const outsider = t.withIdentity({ subject: "another-admin", tokenIdentifier: "another-token", client_id: "client_test_bara" });
    await outsider.mutation(api.appUsers.ensureCurrent, {});
    const otherOrg = (await outsider.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    await expect(outsider.mutation(api.displayPairing.updateDisplay, { ...args, organizationId: otherOrg })).rejects.toThrow("unavailable");
    await expect(owner.mutation(api.displayPairing.updateDisplay, { ...args, label: " " })).rejects.toThrow("Enter a display name");
    await owner.mutation(api.displayPairing.updateDisplay, args);
    const fleet = await owner.query(api.displayPairing.fleet, { organizationId });
    expect(fleet.devices).toEqual([expect.objectContaining({ deviceId, roomId, label: "Hall display", platform: "other" })]);
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "paired", roomId, deviceLabel: "Hall display" });
  });

  it("creates and assigns the first room during registration without a roster", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);
    const outsider = t.withIdentity({ subject: "outsider", tokenIdentifier: "outsider-token", client_id: "client_test_bara" });
    await owner.mutation(api.appUsers.ensureCurrent, {});
    await outsider.mutation(api.appUsers.ensureCurrent, {});
    const organizationId = (await owner.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const credential = "K".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected code");
    const args = { organizationId, code: waiting.code, label: "Pilot iPad", platform: "ipad" as const, roomId: null, newRoomName: " Room  223 " };
    await expect(outsider.mutation(api.displayPairing.register, args)).rejects.toThrow("administrator");
    await expect(owner.mutation(api.displayPairing.register, { ...args, newRoomName: "   " })).rejects.toThrow("Enter a room name");
    expect(await owner.query(api.displayPairing.fleet, { organizationId })).toEqual({ rooms: [], devices: [] });

    const result = await owner.mutation(api.displayPairing.register, args);
    expect(result).toHaveProperty("deviceId");
    expect(await owner.mutation(api.displayPairing.register, args)).toEqual(result);
    const fleet = await owner.query(api.displayPairing.fleet, { organizationId });
    expect(fleet.rooms).toHaveLength(1);
    const roomId = fleet.rooms[0]!.roomId;
    expect(fleet.rooms[0]).toMatchObject({ roomId, label: "Room 223", occupied: true });
    expect(fleet.devices).toEqual([expect.objectContaining({ deviceId: result.deviceId, roomId })]);
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "paired", roomId, deviceLabel: "Pilot iPad" });
    expect(await t.query(api.rooms.display, { roomId, credential })).toMatchObject({ label: "Room 223", proof: null });
    await t.mutation(api.displayPairing.report, { credential, launchId: "first-launch", roomId });
    vi.advanceTimersByTime(5_000);
    await t.mutation(api.displayPairing.report, { credential, launchId: "after-reopen", roomId });
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).devices[0]).toMatchObject({ roomId, openedAt: Date.now() });

    const nextCredential = "L".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(nextCredential));
    const next = await t.query(api.displayPairing.status, { credential: nextCredential });
    if (next.state !== "waiting") throw new Error("Expected code");
    await expect(owner.mutation(api.displayPairing.register, { ...args, code: next.code, newRoomName: "ROOM 223" }))
      .rejects.toThrow("already has a display");
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).devices).toHaveLength(1);
    expect(await t.query(api.displayPairing.status, { credential: nextCredential })).toEqual(next);

    vi.setSystemTime(Date.now() + displayPairingLifetime);
    expect(await owner.mutation(api.displayPairing.register, { ...args, code: next.code, newRoomName: "Expired room" })).toHaveProperty("error");
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).rooms).toEqual(fleet.rooms);
  });

  it("assigns the first room from the editor and leaves later additions unassigned", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);
    await owner.mutation(api.appUsers.ensureCurrent, {});
    const organizationId = (await owner.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const credential = "M".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected code");
    const { deviceId } = await owner.mutation(api.displayPairing.register, {
      organizationId, code: waiting.code, label: "Pilot iPad", platform: "ipad", roomId: null,
    });
    if (!deviceId) throw new Error("Expected device");
    const assignment = { organizationId, deviceId };
    const first = await owner.mutation(api.displayPairing.addRoom, { ...assignment, name: "Room 101" });
    const second = await owner.mutation(api.displayPairing.addRoom, { ...assignment, name: "Lab" });
    await expect(owner.mutation(api.displayPairing.renameRoom, { organizationId, roomId: first, name: " lab " }))
      .rejects.toThrow("already exists");
    await owner.mutation(api.displayPairing.renameRoom, { organizationId, roomId: first, name: "Room 102" });
    expect(await t.query(api.rooms.display, { roomId: first, credential })).toMatchObject({ label: "Room 102" });
    expect(await t.query(api.displayPairing.status, { credential })).toMatchObject({ state: "paired", roomId: first });
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).rooms).toEqual([
      { roomId: second, label: "Lab", occupied: false },
      { roomId: first, label: "Room 102", occupied: true },
    ]);
    await owner.mutation(api.displayPairing.removeRoom, { organizationId, roomId: first });
    expect(await t.query(api.displayPairing.status, { credential })).toMatchObject({ state: "registered" });
    expect(await t.query(api.rooms.display, { roomId: first, credential })).toBeNull();
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).rooms).toEqual([
      { roomId: second, label: "Lab", occupied: false },
    ]);
    const replacement = await owner.mutation(api.displayPairing.addRoom, { ...assignment, name: "Room 102" });
    expect(replacement).not.toBe(first);
    expect(await t.query(api.displayPairing.status, { credential })).toMatchObject({ state: "paired", roomId: replacement });
  });

  it("preserves room history and refuses removal during open classes or across organizations", async () => {
    const { t, owner, learner, roomId, rosterId, sessionId } = await setup();
    const { organizations } = await owner.query(api.displayPairing.adminOptions, {});
    const organizationId = organizations[0]!.organizationId;
    const args = { organizationId, roomId };
    await expect(learner.mutation(api.displayPairing.removeRoom, args)).rejects.toThrow("administrator");
    const outsider = t.withIdentity({ subject: "outsider", tokenIdentifier: "outsider-token", client_id: "client_test_bara" });
    await outsider.mutation(api.appUsers.ensureCurrent, {});
    const otherOrg = (await outsider.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    await expect(outsider.mutation(api.displayPairing.renameRoom, { organizationId: otherOrg, roomId, name: "Moved" }))
      .rejects.toThrow("unavailable");
    await expect(owner.mutation(api.displayPairing.removeRoom, args)).rejects.toThrow("open class");
    await owner.mutation(api.sessions.close, { sessionId });
    await owner.mutation(api.displayPairing.removeRoom, args);
    expect(await owner.query(api.rooms.meeting, { sessionId })).toMatchObject({ roomId, label: "223" });
    expect(await owner.query(api.rooms.listForRoster, { rosterId })).toMatchObject({ rooms: [], defaultRoomId: null });
    const next = await owner.mutation(api.sessions.start, { rosterId, date: "2026-11-09", roomMode: true });
    expect(await owner.query(api.rooms.meeting, { sessionId: next })).toMatchObject({ roomId: null });
  });

  it("registers once, assigns and moves a receiver, and tracks valid launches", async () => {
    const { t, owner, learner, rosterId, roomId } = await setup();
    const { organizations } = await owner.query(api.displayPairing.adminOptions, {});
    const organizationId = organizations[0]!.organizationId;
    const credential = "F".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected code");
    const args = { organizationId, code: waiting.code, label: "Hall tablet", platform: "ipad" as const, roomId: null };
    await expect(learner.mutation(api.displayPairing.register, args)).rejects.toThrow();
    const result = await owner.mutation(api.displayPairing.register, args);
    if (!result.deviceId) throw new Error("Expected device");
    expect(await owner.mutation(api.displayPairing.register, args)).toEqual(result);
    expect(await owner.mutation(api.rooms.pairDisplayByCode, { rosterId, roomId, code: waiting.code })).toBe("pairing_code_invalid");
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "registered", deviceLabel: "Hall tablet" });
    await expect(owner.mutation(api.displayPairing.assign, { organizationId, deviceId: result.deviceId, roomId })).rejects.toThrow("already has a display");
    await owner.mutation(api.rooms.revokeDisplay, { rosterId, roomId });
    await owner.mutation(api.displayPairing.assign, { organizationId, deviceId: result.deviceId, roomId });
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "paired", roomId, deviceLabel: "Hall tablet" });
    expect(await t.query(api.rooms.display, { roomId, credential })).toMatchObject({ label: "223" });
    await t.mutation(api.displayPairing.report, { credential, launchId: "launch-one", roomId: null });
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).devices[0]!.lastSeenAt).toBeNull();
    await t.mutation(api.displayPairing.report, { credential, launchId: "launch-one", roomId });
    const openedAt = Date.now();
    expect(await t.mutation(api.displayPairing.report, { credential, launchId: "launch-two", roomId })).toBe(2_000);
    vi.advanceTimersByTime(2_000);
    await t.mutation(api.displayPairing.report, { credential, launchId: "launch-two", roomId });
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).devices[0]).toMatchObject({ roomId, openedAt: openedAt + 2_000, lastSeenAt: openedAt + 2_000 });
    expect(await t.mutation(api.displayPairing.report, { credential, launchId: "launch-two", roomId })).toBe(60_000);
    // A legacy replacement leaves a stale fleet assignment, which must not clear the new key.
    const replacement = await owner.mutation(api.rooms.pairDisplay, { rosterId, roomId });
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "registered", deviceLabel: "Hall tablet" });
    expect((await owner.query(api.displayPairing.fleet, { organizationId })).devices[0]!.roomId).toBeNull();
    await owner.mutation(api.displayPairing.assign, { organizationId, deviceId: result.deviceId, roomId: null });
    expect(await t.query(api.rooms.display, { roomId, credential: replacement })).not.toBeNull();
  });

  it("reserves a registered credential while its organization is inactive", async () => {
    const { t, owner } = await setup();
    const organizationId = (await owner.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const credential = "Q".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected code");
    const args = { organizationId, code: waiting.code, label: "Tablet", platform: "ipad" as const, roomId: null };
    expect(await owner.mutation(api.displayPairing.register, args)).toHaveProperty("deviceId");
    await t.run(ctx => ctx.db.patch(organizationId, { status: "disabled" }));
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "unpaired" });
    expect(await t.mutation(api.displayPairing.begin, await signedPairing(credential))).toBe("forbidden");
    await t.run(ctx => ctx.db.patch(organizationId, { status: "active" }));
    expect(await t.query(api.displayPairing.status, { credential })).toEqual({ state: "registered", deviceLabel: "Tablet" });
  });

  it("rejects expired, consumed, and cross-organization registrations", async () => {
    const { t, owner, rosterId, roomId } = await setup();
    const organizationId = (await owner.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const credential = "G".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(credential));
    const waiting = await t.query(api.displayPairing.status, { credential });
    if (waiting.state !== "waiting") throw new Error("Expected code");
    expect(await owner.mutation(api.rooms.pairDisplayByCode, { rosterId, roomId, code: waiting.code })).toBe("paired");
    const args = { organizationId, code: waiting.code, label: "Tablet", platform: "other" as const, roomId: null };
    expect(await owner.mutation(api.displayPairing.register, args)).toHaveProperty("error");
    const other = t.withIdentity({ subject: "other", tokenIdentifier: "other-token", client_id: "client_test_bara" });
    await other.mutation(api.appUsers.ensureCurrent, {});
    await expect(other.query(api.displayPairing.fleet, { organizationId })).rejects.toThrow();
    const otherOrg = (await other.query(api.displayPairing.adminOptions, {})).organizations[0]!.organizationId;
    const otherRoster = await other.mutation(api.rosters.importCsv, { name: "Other", students: [student] });
    const otherRoom = await other.mutation(api.rooms.create, { rosterId: otherRoster, label: "Other room" });
    const newCredential = "J".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(newCredential));
    const newWaiting = await t.query(api.displayPairing.status, { credential: newCredential });
    if (newWaiting.state !== "waiting") throw new Error("Expected code");
    await expect(owner.mutation(api.displayPairing.register, { ...args, code: newWaiting.code, roomId: otherRoom })).rejects.toThrow("unavailable");
    await expect(owner.query(api.displayPairing.fleet, { organizationId: otherOrg })).rejects.toThrow();
    const pikaRoom = await t.run(async ctx => ctx.db.insert("rooms", { organizationId, createdByAppUserId: (await ctx.db.get(roomId))!.createdByAppUserId, label: "Pika", labelKey: "pika", pikaInstallationRef: "pika", notices: [], qrRevision: "revision" }));
    await expect(owner.mutation(api.displayPairing.register, { ...args, code: newWaiting.code, roomId: pikaRoom })).rejects.toThrow("unavailable");
    const emptyRoom = await owner.mutation(api.rooms.create, { rosterId, label: "Empty" });
    expect(await owner.mutation(api.displayPairing.register, { ...args, code: newWaiting.code, roomId: emptyRoom })).toHaveProperty("deviceId");
    expect(await t.query(api.displayPairing.status, { credential: newCredential })).toEqual({ state: "paired", roomId: emptyRoom, deviceLabel: "Tablet" });
    expect(await t.query(api.rooms.display, { roomId: emptyRoom, credential: newCredential })).not.toBeNull();
    const expired = "H".repeat(40);
    await t.mutation(api.displayPairing.begin, await signedPairing(expired));
    const expiring = await t.query(api.displayPairing.status, { credential: expired });
    if (expiring.state !== "waiting") throw new Error("Expected code");
    vi.advanceTimersByTime(displayPairingLifetime);
    expect(await owner.mutation(api.displayPairing.register, { ...args, code: expiring.code })).toHaveProperty("error");
  });
});
