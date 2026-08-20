import { v } from "convex/values";

const participantSnapshotValidator = v.object({
  participant_ref: v.string(),
  display_name: v.string(),
  active: v.boolean(),
  workos_subject: v.optional(v.string()),
});

export const rosterSnapshotValidator = v.object({
  schema_version: v.literal(1),
  message_type: v.literal("roster.snapshot"),
  idempotency_key: v.string(),
  correlation_ref: v.string(),
  installation_ref: v.string(),
  roster_ref: v.string(),
  tenant_ref: v.string(),
  revision: v.number(),
  owner_workos_subject: v.string(),
  owner_display_name: v.string(),
  display_name: v.string(),
  participants: v.array(participantSnapshotValidator),
});

const occurrenceSnapshotValidator = v.object({
  occurrence_ref: v.string(),
  date: v.string(),
  title: v.string(),
  opens_at: v.string(),
  closes_at: v.string(),
});

export const scheduleSnapshotValidator = v.object({
  schema_version: v.literal(1),
  message_type: v.literal("schedule.snapshot"),
  idempotency_key: v.string(),
  correlation_ref: v.string(),
  installation_ref: v.string(),
  roster_ref: v.string(),
  revision: v.number(),
  timezone: v.string(),
  window_start: v.string(),
  window_end: v.string(),
  occurrences: v.array(occurrenceSnapshotValidator),
});

export const sessionCommandValidator = v.object({
  schema_version: v.literal(1),
  message_type: v.literal("session.command"),
  idempotency_key: v.string(),
  correlation_ref: v.string(),
  installation_ref: v.string(),
  roster_ref: v.string(),
  occurrence_ref: v.string(),
  command: v.union(v.literal("open"), v.literal("close")),
  actor_workos_subject: v.string(),
  actor_display_name: v.string(),
});

const attendanceMarkValidator = v.object({
  command_ref: v.string(),
  participant_ref: v.string(),
  status: v.union(
    v.literal("unmarked"),
    v.literal("present"),
    v.literal("late"),
    v.literal("absent"),
  ),
  reason_code: v.optional(v.string()),
});

export const attendanceMarksValidator = v.object({
  schema_version: v.literal(1),
  message_type: v.literal("attendance.marks"),
  idempotency_key: v.string(),
  correlation_ref: v.string(),
  installation_ref: v.string(),
  roster_ref: v.string(),
  occurrence_ref: v.string(),
  actor_workos_subject: v.string(),
  actor_display_name: v.string(),
  marks: v.array(attendanceMarkValidator),
});

export const studentCheckInValidator = v.object({
  schema_version: v.literal(1),
  message_type: v.literal("student_check_in"),
  idempotency_key: v.string(),
  correlation_ref: v.string(),
  installation_ref: v.string(),
  roster_ref: v.string(),
  occurrence_ref: v.string(),
  check_in_token: v.string(),
  actor_workos_subject: v.string(),
  actor_display_name: v.string(),
});

export const applyResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    outcome: v.union(v.literal("applied"), v.literal("duplicate")),
    roster_ref: v.string(),
    revision: v.number(),
    created_count: v.number(),
    updated_count: v.number(),
    deactivated_count: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("replayed_request"),
      v.literal("idempotency_conflict"),
      v.literal("owner_not_found"),
      v.literal("owner_not_authorized"),
      v.literal("owner_mismatch"),
      v.literal("stale_revision"),
      v.literal("integration_state_invalid"),
    ),
  }),
);

export const scheduleApplyResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    outcome: v.union(v.literal("applied"), v.literal("duplicate")),
    roster_ref: v.string(),
    revision: v.number(),
    scheduled_count: v.number(),
    updated_count: v.number(),
    cancelled_count: v.number(),
    preserved_count: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("replayed_request"),
      v.literal("idempotency_conflict"),
      v.literal("roster_not_found"),
      v.literal("owner_not_authorized"),
      v.literal("stale_revision"),
      v.literal("integration_state_invalid"),
    ),
  }),
);

export const sessionCommandResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    outcome: v.union(v.literal("applied"), v.literal("duplicate"), v.literal("unchanged")),
    occurrence_ref: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    session_revision: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("replayed_request"),
      v.literal("idempotency_conflict"),
      v.literal("actor_not_found"),
      v.literal("actor_not_authorized"),
      v.literal("occurrence_not_found"),
      v.literal("invalid_session_state"),
      v.literal("active_session_conflict"),
      v.literal("roster_empty"),
      v.literal("integration_state_invalid"),
    ),
  }),
);

export const attendanceMarksResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    outcome: v.union(v.literal("applied"), v.literal("duplicate")),
    occurrence_ref: v.string(),
    session_revision: v.number(),
    applied_count: v.number(),
    unchanged_count: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("replayed_request"),
      v.literal("idempotency_conflict"),
      v.literal("actor_not_found"),
      v.literal("actor_not_authorized"),
      v.literal("occurrence_not_found"),
      v.literal("participant_not_found"),
      v.literal("invalid_session_state"),
      v.literal("integration_state_invalid"),
    ),
  }),
);

const studentCheckInRecordValidator = v.object({
  participant_ref: v.string(),
  record_revision: v.number(),
  status: v.union(
    v.literal("unmarked"),
    v.literal("present"),
    v.literal("late"),
    v.literal("absent"),
  ),
  modified_at: v.string(),
});

export const studentCheckInResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    schema_version: v.literal(1),
    outcome: v.union(v.literal("applied"), v.literal("duplicate"), v.literal("rejected")),
    result_code: v.union(
      v.literal("present_marked"),
      v.literal("already_present"),
      v.literal("already_late"),
      v.literal("review_needed"),
      v.literal("not_on_roster"),
      v.literal("session_closed"),
      v.literal("invalid_check_in_token"),
      v.literal("not_authorized"),
    ),
    occurrence_ref: v.string(),
    session_revision: v.number(),
    record: v.optional(studentCheckInRecordValidator),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("replayed_request"),
      v.literal("idempotency_conflict"),
      v.literal("occurrence_not_found"),
      v.literal("invalid_session_state"),
      v.literal("integration_state_invalid"),
    ),
  }),
);

export const sessionSnapshotValidator = v.union(
  v.null(),
  v.object({
    schema_version: v.literal(1),
    occurrence_ref: v.string(),
    roster_ref: v.string(),
    session_revision: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("cancelled"),
    ),
    opens_at: v.string(),
    closes_at: v.string(),
    records: v.array(v.object({
      participant_ref: v.string(),
      record_revision: v.number(),
      status: v.union(
        v.literal("unmarked"),
        v.literal("present"),
        v.literal("late"),
        v.literal("absent"),
      ),
      source: v.union(
        v.literal("student_qr"),
        v.literal("staff_manual"),
        v.literal("system_finalize"),
      ),
      actor_type: v.union(v.literal("student"), v.literal("staff"), v.literal("system")),
      modified_at: v.string(),
    })),
  }),
);

export const checkInPresentationResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    schema_version: v.literal(1),
    occurrence_ref: v.string(),
    session_revision: v.number(),
    check_in_path: v.string(),
    valid_until: v.string(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("actor_not_found"),
      v.literal("actor_not_authorized"),
      v.literal("occurrence_not_found"),
      v.literal("invalid_session_state"),
      v.literal("integration_state_invalid"),
    ),
  }),
);
