// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const originalSeedDataFlag = process.env.TAPCHECK_ENABLE_SEED_DATA;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

const seedTeacherIdentity = {
  subject: "seed-teacher-1",
  issuer: "https://seed.tapcheck.local",
  tokenIdentifier: "seed:teacher@example.com",
  email: "teacher@example.com",
  emailVerified: true,
  name: "Seed Teacher",
};

const realStudentIdentity = {
  subject: "user_student_real_1",
  issuer: "https://api.workos.com/user_management/client_test",
  tokenIdentifier: "https://api.workos.com/user_management/client_test|user_student_real_1",
  email: "student@example.edu",
  emailVerified: true,
  name: "Student Seed",
};

describe("smoke-test seed data", () => {
  afterEach(() => {
    restoreEnv("TAPCHECK_ENABLE_SEED_DATA", originalSeedDataFlag);
  });

  it("is disabled unless explicitly enabled in the Convex deployment", async () => {
    delete process.env.TAPCHECK_ENABLE_SEED_DATA;
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity(seedTeacherIdentity);

    await expect(
      teacher.mutation(api.rosters.seedSmokeTest, {
        studentEmail: "student@example.edu",
      }),
    ).rejects.toThrow("Seed data is disabled");
  });

  it("creates a QR-ready roster and links the later real WorkOS student identity by verified email", async () => {
    process.env.TAPCHECK_ENABLE_SEED_DATA = "true";
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity(seedTeacherIdentity);

    const seeded = await teacher.mutation(api.rosters.seedSmokeTest, {
      rosterName: "Seeded QR Smoke Test",
      studentEmail: "student@example.edu",
      studentId: "9001",
      studentName: "Student Seed",
    });

    const seededRoster = await teacher.query(api.rosters.getById, { rosterId: seeded.rosterId });
    expect(seededRoster?.verifiedCheckIn).toMatchObject({
      totalStudents: 1,
      readyStudents: 1,
      linkedStudents: 1,
    });
    expect(seededRoster?.students[0]).toMatchObject({
      studentId: "9001",
      schoolEmail: "student@example.edu",
      linkStatus: "linked",
      linkedAppUserId: seeded.studentAppUserId,
    });

    const student = t.withIdentity(realStudentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    expect(currentStudent._id).toBe(seeded.studentAppUserId);
    expect(currentStudent.identity).toMatchObject({
      provider: "workos",
      email: "student@example.edu",
    });

    await teacher.mutation(api.sessions.start, {
      rosterId: seeded.rosterId,
      date: "2026-05-13",
    });
    const openedRoster = await teacher.query(api.rosters.getById, { rosterId: seeded.rosterId });
    const checkInToken = openedRoster?.sessions[0]?.checkInToken;
    expect(checkInToken).toBeTruthy();

    const checkIn = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken!,
    });

    expect(checkIn).toMatchObject({
      code: "present_marked",
      attendanceStatus: "present",
      student: {
        displayName: "Student Seed",
        studentId: "9001",
      },
    });
  });
});
