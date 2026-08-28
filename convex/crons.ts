import { cronJobs } from "convex/server";
import { internal, internalActions } from "./api";

const crons = cronJobs();

crons.interval(
  "process scheduled attendance occurrences",
  { minutes: 1 },
  internalActions.pikaAutomation.processDueOccurrences,
  {},
);

crons.interval(
  "deliver attendance events to Pika",
  { minutes: 1 },
  internalActions.pikaOutbox.deliver,
  {},
);

crons.interval(
  "deliver WorkOS Magic Auth emails through Brevo",
  { minutes: 1 },
  internalActions.workosMagicEmail.deliver,
  {},
);

crons.interval(
  "clean completed WorkOS Magic Auth email metadata",
  { hours: 24 },
  internal.workosMagicEmailModel.cleanup,
  {},
);

crons.interval(
  "clean expired Pika replay and idempotency records",
  { hours: 24 },
  internal.pikaRetention.cleanup,
  {},
);

export default crons;
