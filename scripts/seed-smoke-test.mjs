#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }

  return value;
}

function readOptionalEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

const teacherEmail = readRequiredEnv("TAPCHECK_SEED_TEACHER_EMAIL").toLowerCase();
const studentEmail = readRequiredEnv("TAPCHECK_SEED_STUDENT_EMAIL").toLowerCase();

if (teacherEmail === studentEmail) {
  console.error("TAPCHECK_SEED_TEACHER_EMAIL and TAPCHECK_SEED_STUDENT_EMAIL must be different.");
  process.exit(1);
}

const teacherName = readOptionalEnv("TAPCHECK_SEED_TEACHER_NAME", "Seed Teacher");
const studentName = readOptionalEnv("TAPCHECK_SEED_STUDENT_NAME", "Smoke Test Student");
const studentId = readOptionalEnv("TAPCHECK_SEED_STUDENT_ID", "9001");
const rosterName = readOptionalEnv("TAPCHECK_SEED_ROSTER_NAME", "Tapcheck QR Smoke Test");

const identity = {
  subject: `seed-teacher:${teacherEmail}`,
  issuer: "https://seed.tapcheck.local",
  tokenIdentifier: `seed:teacher:${teacherEmail}`,
  email: teacherEmail,
  emailVerified: true,
  name: teacherName,
};

const args = {
  rosterName,
  studentEmail,
  studentId,
  studentName,
};

const result = spawnSync(
  "npx",
  ["convex", "run", "--push", "rosters:seedSmokeTest", "--identity", JSON.stringify(identity), JSON.stringify(args)],
  {
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
