import { cronJobs } from "convex/server";
import { internal, internalActions } from "./api";

const crons = cronJobs();

// These jobs are recovery sweeps, not the primary delivery path. Attendance
// occurrences are scheduled for their exact open/close times, while Pika
// outbox events and WorkOS emails schedule immediate delivery when enqueued.
// A 15-minute fallback keeps recovery available without polling idle queues
// every minute.

crons.interval(
  "process scheduled attendance occurrences",
  { minutes: 15 },
  internalActions.pikaAutomation.processDueOccurrences,
  {},
);

crons.interval(
  "deliver attendance events to Pika",
  { minutes: 15 },
  internalActions.pikaOutbox.deliver,
  {},
);

crons.interval(
  "deliver WorkOS Magic Auth emails through Brevo",
  { minutes: 15 },
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
