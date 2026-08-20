// Pure version 1 Pika-attendance integration contract.
//
// This package deliberately imports no application, Convex, Supabase, WorkOS,
// or schema-library types. Applications translate at their adapters.

export const SCHEMA_VERSION = 1 as const;

export const V1_MESSAGE_TYPES = [
  "roster.snapshot",
  "schedule.snapshot",
  "session.command",
  "attendance.marks",
  "check_in.presentation",
  "student_check_in",
] as const;

export type V1MessageType = (typeof V1_MESSAGE_TYPES)[number];

export const V1_EVENT_TYPES = [
  "attendance.session.scheduled",
  "attendance.session.opened",
  "attendance.session.closed",
  "attendance.session.cancelled",
  "attendance.record.changed",
] as const;

export type V1EventType = (typeof V1_EVENT_TYPES)[number];
export type OpaqueRef = string;
export type AttendanceStatus = "unmarked" | "present" | "late" | "absent";
export type AttendanceSource = "student_qr" | "staff_manual" | "system_finalize";
export type ActorType = "student" | "staff" | "system";

export interface V1ParticipantSnapshot {
  participant_ref: OpaqueRef;
  display_name: string;
  active: boolean;
  principal_ref?: OpaqueRef;
}

export interface V1OccurrenceSnapshot {
  occurrence_ref: OpaqueRef;
  date: string;
  title: string;
  opens_at: string;
  closes_at: string;
}

export interface V1MarkCommand {
  command_ref: OpaqueRef;
  participant_ref: OpaqueRef;
  status: AttendanceStatus;
  reason_code?: OpaqueRef;
}

interface V1MessageBase<T extends V1MessageType> {
  schema_version: typeof SCHEMA_VERSION;
  message_type: T;
  idempotency_key: string;
  correlation_ref: OpaqueRef;
  installation_ref: OpaqueRef;
  roster_ref: OpaqueRef;
}

export interface V1RosterSnapshot extends V1MessageBase<"roster.snapshot"> {
  tenant_ref: OpaqueRef;
  revision: number;
  owner_principal_ref: OpaqueRef;
  owner_display_name: string;
  display_name: string;
  participants: V1ParticipantSnapshot[];
}

export interface V1ScheduleSnapshot extends V1MessageBase<"schedule.snapshot"> {
  revision: number;
  timezone: string;
  window_start: string;
  window_end: string;
  occurrences: V1OccurrenceSnapshot[];
}

export interface V1SessionCommand extends V1MessageBase<"session.command"> {
  occurrence_ref: OpaqueRef;
  command: "open" | "close";
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export interface V1AttendanceMarks extends V1MessageBase<"attendance.marks"> {
  occurrence_ref: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
  marks: V1MarkCommand[];
}

export interface V1CheckInPresentationRequest
  extends V1MessageBase<"check_in.presentation"> {
  occurrence_ref: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export interface V1StudentCheckIn extends V1MessageBase<"student_check_in"> {
  occurrence_ref: OpaqueRef;
  check_in_token: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export type V1Message =
  | V1RosterSnapshot
  | V1ScheduleSnapshot
  | V1SessionCommand
  | V1AttendanceMarks
  | V1CheckInPresentationRequest
  | V1StudentCheckIn;

export interface V1StudentCheckInRecord {
  participant_ref: OpaqueRef;
  record_revision: number;
  status: AttendanceStatus;
  modified_at: string;
}

export interface V1StudentCheckInResult {
  ok: true;
  schema_version: typeof SCHEMA_VERSION;
  outcome: "applied" | "duplicate" | "rejected";
  result_code:
    | "present_marked"
    | "already_present"
    | "already_late"
    | "review_needed"
    | "not_on_roster"
    | "session_closed"
    | "invalid_check_in_token"
    | "not_authorized";
  occurrence_ref: OpaqueRef;
  session_revision: number;
  record?: V1StudentCheckInRecord;
}

export interface V1CheckInPresentation {
  schema_version: typeof SCHEMA_VERSION;
  occurrence_ref: OpaqueRef;
  session_revision: number;
  check_in_path: string;
  valid_until: string;
}

export interface V1SessionSnapshotRecord {
  participant_ref: OpaqueRef;
  record_revision: number;
  status: AttendanceStatus;
  source: AttendanceSource;
  actor_type: ActorType;
  modified_at: string;
}

export interface V1SessionSnapshot {
  schema_version: typeof SCHEMA_VERSION;
  occurrence_ref: OpaqueRef;
  roster_ref: OpaqueRef;
  session_revision: number;
  status: "scheduled" | "open" | "closed" | "cancelled";
  opens_at: string;
  closes_at: string;
  records: V1SessionSnapshotRecord[];
}

export type V1EventMetadata = {
  "attendance.session.scheduled": {
    opens_at: string;
    closes_at: string;
  };
  "attendance.session.opened": {
    opened_at: string;
    trigger: "schedule" | "staff";
  };
  "attendance.session.closed": {
    closed_at: string;
    trigger: "schedule" | "staff";
  };
  "attendance.session.cancelled": {
    cancelled_at: string;
    reason_code:
      | "schedule_removed"
      | "staff_cancelled"
      | "missed_window"
      | "automation_failed";
  };
  "attendance.record.changed": {
    participant_ref: OpaqueRef;
    record_revision: number;
    from_status: AttendanceStatus;
    to_status: AttendanceStatus;
    source: AttendanceSource;
    actor_type: ActorType;
    reason_code?: OpaqueRef;
  };
};

export type V1Event<T extends V1EventType = V1EventType> = T extends V1EventType
  ? {
      schema_version: typeof SCHEMA_VERSION;
      event_id: OpaqueRef;
      idempotency_key: string;
      correlation_ref: OpaqueRef;
      event_type: T;
      occurred_at: string;
      installation_ref: OpaqueRef;
      roster_ref: OpaqueRef;
      occurrence_ref: OpaqueRef;
      session_revision: number;
      metadata: V1EventMetadata[T];
    }
  : never;

export const V1_ERRORS = [
  "unsupported_schema_version",
  "missing_required_fields",
  "unknown_message_type",
  "unknown_event_type",
  "invalid_envelope",
  "invalid_payload",
] as const;

export type V1Error = (typeof V1_ERRORS)[number];

export type V1ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: V1Error; detail: string };
