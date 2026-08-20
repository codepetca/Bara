// JSON-compatible provider fixtures. Pika vendors this file byte-for-byte and
// runs the same expectations against its reviewed v1 validator copy.

export const validV1MessageFixtures = [
  {
    schema_version: 1,
    message_type: "roster.snapshot",
    idempotency_key: "fixture:roster:1",
    correlation_ref: "fixture_roster",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    tenant_ref: "tenant_one",
    revision: 1,
    owner_principal_ref: "principal_teacher",
    owner_display_name: "Teacher One",
    display_name: "Period 1",
    participants: [{
      participant_ref: "participant_one",
      display_name: "Student One",
      active: true,
      principal_ref: "principal_student",
    }],
  },
  {
    schema_version: 1,
    message_type: "schedule.snapshot",
    idempotency_key: "fixture:schedule:1",
    correlation_ref: "fixture_schedule",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    revision: 1,
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
  },
  {
    schema_version: 1,
    message_type: "session.command",
    idempotency_key: "fixture:session:open:1",
    correlation_ref: "fixture_session",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    command: "open",
    actor_principal_ref: "principal_teacher",
    actor_display_name: "Teacher One",
  },
  {
    schema_version: 1,
    message_type: "attendance.marks",
    idempotency_key: "fixture:marks:1",
    correlation_ref: "fixture_marks",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    actor_principal_ref: "principal_teacher",
    actor_display_name: "Teacher One",
    marks: [{
      command_ref: "mark_one",
      participant_ref: "participant_one",
      status: "present",
    }],
  },
  {
    schema_version: 1,
    message_type: "check_in.presentation",
    idempotency_key: "fixture:presentation:1",
    correlation_ref: "fixture_presentation",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    actor_principal_ref: "principal_teacher",
    actor_display_name: "Teacher One",
  },
  {
    schema_version: 1,
    message_type: "student_check_in",
    idempotency_key: "fixture:student-check-in:1",
    correlation_ref: "fixture_student_check_in",
    installation_ref: "installation_one",
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    check_in_token: "fixture_check_in_token_12345",
    actor_principal_ref: "principal_student",
    actor_display_name: "Student One",
  },
] as const;

export const invalidV1MessageFixtures = [
  { name: "unsupported version", value: { ...validV1MessageFixtures[5], schema_version: 2 } },
  { name: "client identity field", value: { ...validV1MessageFixtures[5], client_user_id: "raw-id" } },
  {
    name: "duplicate participant ref",
    value: {
      ...validV1MessageFixtures[0],
      participants: [validV1MessageFixtures[0].participants[0], validV1MessageFixtures[0].participants[0]],
    },
  },
  { name: "missing actor display name", value: (() => {
    const { actor_display_name: removed, ...rest } = validV1MessageFixtures[5];
    void removed;
    return rest;
  })() },
] as const;

export const validV1EventFixture = {
  schema_version: 1,
  event_id: "event_one",
  idempotency_key: "fixture:event:one",
  correlation_ref: "fixture_student_check_in",
  event_type: "attendance.record.changed",
  occurred_at: "2026-09-02T12:51:00Z",
  installation_ref: "installation_one",
  roster_ref: "roster_one",
  occurrence_ref: "occurrence_one",
  session_revision: 2,
  metadata: {
    participant_ref: "participant_one",
    record_revision: 1,
    from_status: "unmarked",
    to_status: "present",
    source: "student_qr",
    actor_type: "student",
  },
} as const;

export const invalidV1EventFixtures = [
  { name: "PII metadata", value: { ...validV1EventFixture, metadata: { ...validV1EventFixture.metadata, email: "student@example.com" } } },
  { name: "out of range revision", value: { ...validV1EventFixture, session_revision: 0 } },
] as const;
