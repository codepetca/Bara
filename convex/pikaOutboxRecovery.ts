import { v } from "convex/values";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import type { Doc } from "./model";
import { internalMutation, type MutationCtx } from "./server";

const ELIGIBLE_ERROR_CODES = ["http_401", "http_403"] as const;
const MAX_LIMIT = 50;
const MAX_DELIVERY_ATTEMPTS = 20;
const MAX_RECOVERY_ATTEMPTS = 3;
const OPAQUE_REF = /^[A-Za-z0-9._~:-]{1,128}$/;

const recoveryResultValidator = v.object({
  inspected: v.number(),
  requeued: v.number(),
  superseded: v.number(),
  ineligible: v.number(),
  exhausted: v.number(),
});

type RecoveryResult = {
  inspected: number;
  requeued: number;
  superseded: number;
  ineligible: number;
  exhausted: number;
};

function configuredInstallationRef() {
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  if (!OPAQUE_REF.test(installationRef)) {
    throw new Error("Attendance recovery is not configured.");
  }
  return installationRef;
}

async function currentDisposition(
  ctx: MutationCtx,
  row: Doc<"pika_outbox">,
): Promise<"requeue" | "supersede" | "ineligible"> {
  const parsed = validateV1Event(JSON.parse(row.payloadJson) as unknown);
  if (!parsed.ok || parsed.value.installation_ref !== row.installationRef) return "ineligible";
  const event = parsed.value;
  const mapping = await ctx.db
    .query("pika_integrated_occurrences")
    .withIndex("by_installationRef_and_occurrenceRef", (q) =>
      q.eq("installationRef", row.installationRef).eq("occurrenceRef", event.occurrence_ref),
    )
    .unique();
  if (!mapping) return "ineligible";
  const occurrence = await ctx.db.get(mapping.occurrenceId);
  if (!occurrence) return "ineligible";

  if (event.event_type !== "attendance.record.changed") {
    if (event.session_revision < occurrence.sessionRevision) return "supersede";
    return event.session_revision === occurrence.sessionRevision ? "requeue" : "ineligible";
  }

  const participantRef = event.metadata.participant_ref;
  const recordRevision = event.metadata.record_revision;
  if (typeof participantRef !== "string" || typeof recordRevision !== "number") {
    return "ineligible";
  }
  const participant = await ctx.db
    .query("pika_integrated_participants")
    .withIndex("by_installationRef_rosterRef_participantRef", (q) =>
      q
        .eq("installationRef", row.installationRef)
        .eq("rosterRef", event.roster_ref)
        .eq("participantRef", participantRef),
    )
    .unique();
  if (!participant || !occurrence.sessionId) return "ineligible";
  const record = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId_participantId", (q) =>
      q.eq("sessionId", occurrence.sessionId!).eq("participantId", participant.participantId),
    )
    .unique();
  if (!record?.recordRevision) return "ineligible";
  if (recordRevision < record.recordRevision) return "supersede";
  return recordRevision === record.recordRevision ? "requeue" : "ineligible";
}

export const recoverFailedEvents = internalMutation({
  args: {
    installationRef: v.string(),
    requestId: v.string(),
    operatorRef: v.string(),
    reasonCode: v.string(),
    limit: v.number(),
    maxDeliveryAttempts: v.number(),
    maxRecoveryAttempts: v.number(),
  },
  returns: recoveryResultValidator,
  handler: async (ctx, args): Promise<RecoveryResult> => {
    if (
      args.installationRef !== configuredInstallationRef() ||
      !OPAQUE_REF.test(args.requestId) ||
      !OPAQUE_REF.test(args.operatorRef) ||
      !OPAQUE_REF.test(args.reasonCode) ||
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > MAX_LIMIT ||
      !Number.isSafeInteger(args.maxDeliveryAttempts) ||
      args.maxDeliveryAttempts < 1 ||
      args.maxDeliveryAttempts > MAX_DELIVERY_ATTEMPTS ||
      !Number.isSafeInteger(args.maxRecoveryAttempts) ||
      args.maxRecoveryAttempts < 1 ||
      args.maxRecoveryAttempts > MAX_RECOVERY_ATTEMPTS
    ) {
      throw new Error("Attendance recovery request is invalid.");
    }

    const prior = await ctx.db
      .query("pika_outbox_recovery_audits")
      .withIndex("by_installationRef_and_requestId", (q) =>
        q.eq("installationRef", args.installationRef).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.operatorRef !== args.operatorRef ||
        prior.reasonCode !== args.reasonCode ||
        prior.limit !== args.limit ||
        prior.maxDeliveryAttempts !== args.maxDeliveryAttempts ||
        prior.maxRecoveryAttempts !== args.maxRecoveryAttempts
      ) {
        throw new Error("Attendance recovery request conflicts with its prior audit.");
      }
      return {
        inspected: prior.inspected,
        requeued: prior.requeued,
        superseded: prior.superseded,
        ineligible: prior.ineligible,
        exhausted: prior.exhausted,
      };
    }

    const now = Date.now();

    const rows = await ctx.db
      .query("pika_outbox")
      .withIndex("by_installationRef_and_status_and_updatedAt", (q) =>
        q.eq("installationRef", args.installationRef).eq("status", "failed"),
      )
      .take(args.limit);
    const result: RecoveryResult = {
      inspected: rows.length,
      requeued: 0,
      superseded: 0,
      ineligible: 0,
      exhausted: 0,
    };

    for (const row of rows) {
      const recoveryCount = row.recoveryCount ?? 0;
      if (
        row.attemptCount >= args.maxDeliveryAttempts ||
        recoveryCount >= args.maxRecoveryAttempts
      ) {
        result.exhausted += 1;
        continue;
      }
      if (!ELIGIBLE_ERROR_CODES.includes(row.lastErrorCode as (typeof ELIGIBLE_ERROR_CODES)[number])) {
        result.ineligible += 1;
        continue;
      }

      let disposition: "requeue" | "supersede" | "ineligible";
      try {
        disposition = await currentDisposition(ctx, row);
      } catch {
        disposition = "ineligible";
      }
      if (disposition === "ineligible") {
        result.ineligible += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        status: disposition === "requeue" ? "pending" : "superseded",
        nextAttemptAt: disposition === "requeue" ? now : row.nextAttemptAt,
        leaseUntil: undefined,
        leaseToken: undefined,
        recoveryCount: recoveryCount + 1,
        lastRecoveryRequestId: args.requestId,
        lastRecoveryReasonCode: args.reasonCode,
        lastRecoveredAt: now,
        updatedAt: now,
      });
      result[disposition === "requeue" ? "requeued" : "superseded"] += 1;
    }

    await ctx.db.insert("pika_outbox_recovery_audits", {
      installationRef: args.installationRef,
      requestId: args.requestId,
      operatorRef: args.operatorRef,
      reasonCode: args.reasonCode,
      eligibleErrorCodes: [...ELIGIBLE_ERROR_CODES],
      limit: args.limit,
      maxDeliveryAttempts: args.maxDeliveryAttempts,
      maxRecoveryAttempts: args.maxRecoveryAttempts,
      ...result,
      createdAt: now,
    });
    return result;
  },
});
