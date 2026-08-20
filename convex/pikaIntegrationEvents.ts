import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import { internal, internalActions } from "./api";
import type { Id } from "./model";
import type { MutationCtx } from "./server";

export async function queueAttendanceEvent(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    rosterRef: string;
    occurrenceRef: string;
    correlationRef: string;
    eventType:
      | "attendance.session.scheduled"
      | "attendance.session.opened"
      | "attendance.session.closed"
      | "attendance.session.cancelled"
      | "attendance.record.changed";
    sessionRevision: number;
    metadata: Record<string, unknown>;
    nonce: string;
    eventIndex: number;
    now: number;
  },
) {
  const eventId = `event_${args.nonce.slice(0, 80)}_${args.eventIndex}`;
  const event = validateV1Event({
    schema_version: 1,
    event_id: eventId,
    idempotency_key: `event:${args.nonce.slice(0, 80)}:${args.eventIndex}`,
    correlation_ref: args.correlationRef,
    event_type: args.eventType,
    occurred_at: new Date(args.now).toISOString(),
    installation_ref: args.installationRef,
    roster_ref: args.rosterRef,
    occurrence_ref: args.occurrenceRef,
    session_revision: args.sessionRevision,
    metadata: args.metadata,
  });
  if (!event.ok) throw new Error("Attendance event could not be created.");

  await ctx.db.insert("pika_outbox", {
    installationRef: args.installationRef,
    eventId,
    eventType: args.eventType,
    correlationRef: args.correlationRef,
    payloadJson: JSON.stringify(event.value),
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
  // convex-test eagerly executes scheduled actions after its transaction has
  // closed; production Convex does not. Keep unit tests deterministic while
  // preserving immediate dispatch in every deployed runtime.
  if (
    args.eventIndex === 0 &&
    process.env.VITEST !== "true" &&
    process.env.PIKA_DISABLE_IMMEDIATE_DISPATCH !== "true"
  ) {
    await ctx.scheduler.runAfter(0, internalActions.pikaOutbox.deliver, { limit: 10 });
  }
}

export async function scheduleExactOccurrenceJobs(
  ctx: MutationCtx,
  opensAt: number,
  closesAt: number,
) {
  if (process.env.VITEST === "true") return;
  await Promise.all([
    ctx.scheduler.runAt(opensAt, internal.pikaIntegration.processDueOccurrences, {}),
    ctx.scheduler.runAt(closesAt, internal.pikaIntegration.processDueOccurrences, {}),
  ]);
}

export async function queueFinalizedRecordEvents(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    rosterRef: string;
    occurrenceRef: string;
    correlationRef: string;
    sessionRevision: number;
    nonce: string;
    eventIndexStart: number;
    now: number;
    changes: Array<{
      participantId: Id<"participants">;
      fromStatus: "unmarked";
      toStatus: "absent";
      recordRevision: number;
    }>;
  },
) {
  if (args.changes.length === 0) return;
  const mappings = await ctx.db
    .query("pika_integrated_participants")
    .withIndex("by_installationRef_and_rosterRef", (q) =>
      q.eq("installationRef", args.installationRef).eq("rosterRef", args.rosterRef),
    )
    .collect();
  const refByParticipantId = new Map(
    mappings.map((mapping) => [mapping.participantId, mapping.participantRef]),
  );

  let eventIndex = args.eventIndexStart;
  for (const change of args.changes) {
    const participantRef = refByParticipantId.get(change.participantId);
    if (!participantRef) continue;
    await queueAttendanceEvent(ctx, {
      installationRef: args.installationRef,
      rosterRef: args.rosterRef,
      occurrenceRef: args.occurrenceRef,
      correlationRef: args.correlationRef,
      eventType: "attendance.record.changed",
      sessionRevision: args.sessionRevision,
      metadata: {
        participant_ref: participantRef,
        record_revision: change.recordRevision,
        from_status: change.fromStatus,
        to_status: change.toStatus,
        source: "system_finalize",
        actor_type: "system",
      },
      nonce: args.nonce,
      eventIndex: eventIndex++,
      now: args.now,
    });
  }
}
