import { cronJobs } from "convex/server";
import { internal, internalActions } from "./api";

const crons = cronJobs();

crons.interval(
  "process scheduled attendance occurrences",
  { minutes: 1 },
  internal.pikaIntegration.processDueOccurrences,
  {},
);

crons.interval(
  "deliver attendance events to Pika",
  { minutes: 1 },
  internalActions.pikaOutbox.deliver,
  {},
);

crons.interval(
  "clean expired Pika replay and idempotency records",
  { hours: 24 },
  internal.pikaRetention.cleanup,
  {},
);

export default crons;
