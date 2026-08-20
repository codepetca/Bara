import { describe, expect, it } from "vitest";
import { validateV1Event, validateV1Message } from "./validate";

const baseMessage = {
  schema_version: 1,
  idempotency_key: "request:one",
  correlation_ref: "correlation_one",
  installation_ref: "installation_one",
  roster_ref: "roster_one",
};

const baseEvent = {
  schema_version: 1,
  event_id: "event_one",
  idempotency_key: "event:one",
  correlation_ref: "correlation_one",
  occurred_at: "2026-08-16T14:05:00Z",
  installation_ref: "installation_one",
  roster_ref: "roster_one",
  occurrence_ref: "occurrence_one",
  session_revision: 2,
};

describe("attendance contract v1 messages", () => {
  it("accepts a bounded roster snapshot and returns a closed value", () => {
    const result = validateV1Message({
      ...baseMessage,
      message_type: "roster.snapshot",
      revision: 3,
      tenant_ref: "tenant_one",
      owner_principal_ref: "principal_teacher_owner",
      owner_display_name: "Teacher Owner",
      display_name: "  Period 1  ",
      participants: [{
        participant_ref: "participant_one",
        display_name: "  Ada Lovelace  ",
        active: true,
        principal_ref: "principal_student_one",
      }],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        owner_principal_ref: "principal_teacher_owner",
        display_name: "Period 1",
        participants: [expect.objectContaining({ display_name: "Ada Lovelace" })],
      }),
    });
  });

  it("rejects PII fields outside the roster allow-list", () => {
    const result = validateV1Message({
      ...baseMessage,
      message_type: "roster.snapshot",
      revision: 1,
      tenant_ref: "tenant_one",
      owner_principal_ref: "principal_teacher_owner",
      owner_display_name: "Teacher Owner",
      display_name: "Period 1",
      participants: [{
        participant_ref: "participant_one",
        display_name: "Ada Lovelace",
        active: true,
        email: "student@example.com",
      }],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("rejects duplicate participant references", () => {
    const participant = { participant_ref: "participant_one", display_name: "Ada", active: true };
    const result = validateV1Message({
      ...baseMessage,
      message_type: "roster.snapshot",
      revision: 1,
      tenant_ref: "tenant_one",
      owner_principal_ref: "principal_teacher_owner",
      owner_display_name: "Teacher Owner",
      display_name: "Period 1",
      participants: [participant, participant],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("requires a verified external identity assertion for roster ownership", () => {
    const result = validateV1Message({
      ...baseMessage,
      message_type: "roster.snapshot",
      revision: 1,
      display_name: "Period 1",
      participants: [],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_envelope" });
  });

  it("accepts concrete UTC occurrence windows", () => {
    const result = validateV1Message({
      ...baseMessage,
      message_type: "schedule.snapshot",
      revision: 2,
      timezone: "America/Toronto",
      window_start: "2026-09-01",
      window_end: "2026-09-30",
      occurrences: [{
        occurrence_ref: "occurrence_one",
        date: "2026-09-02",
        title: "Period 1 attendance",
        opens_at: "2026-09-02T12:50:00Z",
        closes_at: "2026-09-02T13:20:00Z",
      }],
    });

    expect(result).toMatchObject({ ok: true, value: { message_type: "schedule.snapshot" } });
  });

  it("rejects reversed occurrence times and dates outside the snapshot window", () => {
    const input = {
      ...baseMessage,
      message_type: "schedule.snapshot",
      revision: 2,
      timezone: "America/Toronto",
      window_start: "2026-09-01",
      window_end: "2026-09-30",
      occurrences: [{
        occurrence_ref: "occurrence_one",
        date: "2026-10-01",
        title: "Period 1 attendance",
        opens_at: "2026-09-02T13:20:00Z",
        closes_at: "2026-09-02T12:50:00Z",
      }],
    };

    expect(validateV1Message(input)).toMatchObject({ ok: false, error: "invalid_payload" });
    expect(validateV1Message({
      ...input,
      occurrences: [{ ...input.occurrences[0], date: "2026-09-02" }],
    })).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("accepts staff session commands and bounded mark batches", () => {
    expect(validateV1Message({
      ...baseMessage,
      message_type: "session.command",
      occurrence_ref: "occurrence_one",
      command: "open",
      actor_principal_ref: "principal_teacher_one",
      actor_display_name: "Teacher One",
    })).toMatchObject({ ok: true });

    expect(validateV1Message({
      ...baseMessage,
      message_type: "attendance.marks",
      occurrence_ref: "occurrence_one",
      actor_principal_ref: "principal_teacher_one",
      actor_display_name: "Teacher One",
      marks: [{
        command_ref: "mark_one",
        participant_ref: "participant_one",
        status: "present",
        reason_code: "teacher_correction",
      }],
    })).toMatchObject({ ok: true });
  });

  it("accepts a staff-authorized check-in presentation request", () => {
    expect(validateV1Message({
      ...baseMessage,
      message_type: "check_in.presentation",
      occurrence_ref: "occurrence_one",
      actor_principal_ref: "principal_teacher_one",
      actor_display_name: "Teacher One",
    })).toMatchObject({
      ok: true,
      value: {
        message_type: "check_in.presentation",
        occurrence_ref: "occurrence_one",
      },
    });

    expect(validateV1Message({
      ...baseMessage,
      message_type: "check_in.presentation",
      occurrence_ref: "occurrence_one",
      actor_principal_ref: "principal_teacher_one",
      actor_display_name: "Teacher One",
      student_email: "student@example.com",
    })).toMatchObject({ ok: false, error: "invalid_envelope" });
  });

  it("rejects two marks for the same participant in one batch", () => {
    const result = validateV1Message({
      ...baseMessage,
      message_type: "attendance.marks",
      occurrence_ref: "occurrence_one",
      actor_principal_ref: "principal_teacher_one",
      actor_display_name: "Teacher One",
      marks: [
        { command_ref: "mark_one", participant_ref: "participant_one", status: "present" },
        { command_ref: "mark_two", participant_ref: "participant_one", status: "absent" },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("accepts a closed student check-in command without client identity fields", () => {
    expect(validateV1Message({
      ...baseMessage,
      message_type: "student_check_in",
      occurrence_ref: "occurrence_one",
      check_in_token: "fixture_check_in_token_12345",
      actor_principal_ref: "principal_student_one",
      actor_display_name: "Student One",
    })).toMatchObject({
      ok: true,
      value: { message_type: "student_check_in", actor_display_name: "Student One" },
    });

    expect(validateV1Message({
      ...baseMessage,
      message_type: "student_check_in",
      occurrence_ref: "occurrence_one",
      check_in_token: "fixture_check_in_token_12345",
      actor_principal_ref: "principal_student_one",
      actor_display_name: "Student One",
      client_supplied_email: "student@example.com",
    })).toMatchObject({ ok: false, error: "invalid_envelope" });
  });
});

describe("attendance contract v1 events", () => {
  it("accepts a privacy-minimized record change", () => {
    const result = validateV1Event({
      ...baseEvent,
      event_type: "attendance.record.changed",
      metadata: {
        participant_ref: "participant_one",
        record_revision: 4,
        from_status: "unmarked",
        to_status: "present",
        source: "student_qr",
        actor_type: "student",
      },
    });

    expect(result).toMatchObject({ ok: true, value: { event_type: "attendance.record.changed" } });
  });

  it("rejects names, emails, and free-form fields in event metadata", () => {
    const result = validateV1Event({
      ...baseEvent,
      event_type: "attendance.record.changed",
      metadata: {
        participant_ref: "participant_one",
        record_revision: 4,
        from_status: "unmarked",
        to_status: "present",
        source: "student_qr",
        actor_type: "student",
        student_name: "Ada Lovelace",
      },
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_payload" });
  });

  it("rejects unknown event types and non-UTC timestamps", () => {
    expect(validateV1Event({
      ...baseEvent,
      event_type: "attendance.record.deleted",
      metadata: {},
    })).toMatchObject({ ok: false, error: "unknown_event_type" });

    expect(validateV1Event({
      ...baseEvent,
      occurred_at: "2026-08-16T10:05:00-04:00",
      event_type: "attendance.session.opened",
      metadata: { opened_at: "2026-08-16T14:05:00Z", trigger: "schedule" },
    })).toMatchObject({ ok: false, error: "invalid_envelope" });
  });

  it("rejects unexpected envelope fields and unsupported versions", () => {
    expect(validateV1Event({
      ...baseEvent,
      event_type: "attendance.session.opened",
      metadata: { opened_at: "2026-08-16T14:05:00Z", trigger: "schedule" },
      debug: true,
    })).toMatchObject({ ok: false, error: "invalid_envelope" });

    expect(validateV1Event({
      ...baseEvent,
      schema_version: 2,
      event_type: "attendance.session.opened",
      metadata: { opened_at: "2026-08-16T14:05:00Z", trigger: "schedule" },
    })).toMatchObject({ ok: false, error: "unsupported_schema_version" });
  });

  it("rejects impossible UTC dates and PII-shaped idempotency keys", () => {
    expect(validateV1Event({
      ...baseEvent,
      occurred_at: "2026-02-30T14:05:00Z",
      event_type: "attendance.session.opened",
      metadata: { opened_at: "2026-08-16T14:05:00Z", trigger: "schedule" },
    })).toMatchObject({ ok: false, error: "invalid_envelope" });

    expect(validateV1Event({
      ...baseEvent,
      idempotency_key: "student@example.com",
      event_type: "attendance.session.opened",
      metadata: { opened_at: "2026-08-16T14:05:00Z", trigger: "schedule" },
    })).toMatchObject({ ok: false, error: "invalid_envelope" });
  });
});
