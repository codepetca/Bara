import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  PIKA_PRODUCTION_ORIGIN,
  auditBaraAttendanceRolloutEnvironment,
  auditBaraDeploymentEnvironment,
  resolveBaraDeploymentTarget,
} from "./bara-rollout-rules.mjs";

const target = resolveBaraDeploymentTarget(process.env);

if (process.env.VERCEL !== "1" || !target) {
  process.stderr.write("The Convex deploy build may run only in Vercel Preview or Production.\n");
  process.exit(1);
}

const audit = target.stage === "production"
  ? auditBaraAttendanceRolloutEnvironment(process.env, {
    ...target,
    expectedPikaOrigin: PIKA_PRODUCTION_ORIGIN,
    attendanceMode: process.env.PIKA_ATTENDANCE_INTEGRATION === "true"
      ? "enabled"
      : "pre-enable",
  })
  : auditBaraDeploymentEnvironment(process.env, target);

if (!audit.ready) {
  process.stderr.write(`${JSON.stringify(audit, null, 2)}\n`);
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "convex",
    "deploy",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
    "--cmd",
    "pnpm build",
  ],
  { env: process.env, stdio: "inherit" },
);

if (result.error) {
  process.stderr.write("Unable to start the guarded Convex deployment build.\n");
  process.exit(1);
}

process.exit(result.status ?? 1);
