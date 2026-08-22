import process from "node:process";
import { auditBaraAttendanceRolloutEnvironment } from "./bara-rollout-rules.mjs";

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1]?.trim() || undefined;
}

const stage = readArgument("--stage");
const expectedBaraOrigin = readArgument("--expected-bara-origin");
const expectedPikaOrigin = readArgument("--expected-pika-origin");
const attendanceMode = readArgument("--mode");

if (
  (stage !== "preview" && stage !== "production") ||
  (attendanceMode !== "pre-enable" && attendanceMode !== "enabled") ||
  !expectedBaraOrigin ||
  !expectedPikaOrigin
) {
  process.stderr.write(
    "Bara rollout preflight requires mode, stage, and exact Pika/Bara HTTPS origins.\n",
  );
  process.exit(2);
}

const result = auditBaraAttendanceRolloutEnvironment(process.env, {
  stage,
  expectedBaraOrigin,
  expectedPikaOrigin,
  attendanceMode,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ready) process.exit(1);
