import process from "node:process";
import {
  auditBaraAttendanceRolloutEnvironment,
  resolveBaraRolloutTarget,
} from "./bara-rollout-rules.mjs";

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1]?.trim() || undefined;
}

const stage = readArgument("--stage");
const expectedBaraOrigin = readArgument("--expected-bara-origin");
const expectedPikaOrigin = readArgument("--expected-pika-origin");

const target = resolveBaraRolloutTarget({
  stage,
  expectedBaraOrigin,
  expectedPikaOrigin,
});

if (!target) {
  process.stderr.write(
    "Bara rollout preflight requires a supported stage and exact Pika/Bara origins; production must use both canonical origins.\n",
  );
  process.exit(2);
}

const result = auditBaraAttendanceRolloutEnvironment(process.env, target);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ready) process.exit(1);
