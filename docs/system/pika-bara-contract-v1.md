# Pika–Bara attendance contract v1

Status: pre-release contract authority.

## Ownership

Pika owns academic attendance intent:

- session start and end times;
- relative QR opening and closing rules;
- Present, Late, and Absent cutoffs;
- derived attendance status;
- teacher status overrides and Undo.

Bara owns QR execution facts:

- opening and stopping QR acceptance at concrete UTC instants supplied by Pika;
- checking the signed installation, roster, occurrence, token, and principal;
- recording the server timestamp of an accepted check-in;
- idempotency and duplicate detection;
- audited invalidation of accepted check-ins.

Bara does not calculate or transmit Present, Late, Absent, or Unmarked for a
Pika-integrated occurrence. Bara's standalone attendance engine is outside this
contract and may keep its own status model.

## Time semantics

Pika materializes Toronto wall-clock policy into UTC before sending a schedule.
Bara never receives relative phrases such as "10 minutes early".

For an occurrence with `accepts_at = A` and `stops_accepting_at = B`, automatic
QR acceptance is the half-open interval `[A, B)`:

- a request at exactly `A` can be accepted;
- a request at exactly `B` is rejected;
- Bara's mutation clock is authoritative;
- browser and phone clocks are not inputs to the decision.

Opening or closing an occurrence manually changes future acceptance only.
Previously accepted check-ins remain valid until explicitly invalidated.

## Privacy boundary

Pika sends opaque installation, roster, occurrence, participant, and principal
references. Raw Pika database identifiers and student contact details are not
allowed. Display names may appear only in roster snapshots and authenticated
actor assertions.

Bara never receives the Pika WorkOS subject. Pika converts it to an
installation-scoped opaque principal reference before crossing the boundary.

## Messages

Every signed message contains:

- `schema_version` (`1`);
- `message_type`;
- `idempotency_key`;
- `correlation_ref`;
- `installation_ref`;
- `roster_ref`.

Supported messages are:

- `roster.snapshot`;
- `schedule.snapshot`;
- `session.command`;
- `check_in.presentation`;
- `student_check_in`;
- `check_in.invalidate`.

`attendance.marks` is intentionally absent. Teacher status corrections never
cross into Bara.

### Schedule occurrence

```json
{
  "occurrence_ref": "occurrence_one",
  "date": "2026-09-02",
  "title": "Period 1 attendance",
  "accepts_at": "2026-09-02T12:50:00Z",
  "stops_accepting_at": "2026-09-02T13:50:00Z"
}
```

The instants must be valid UTC timestamps and `accepts_at` must be before
`stops_accepting_at`.

### Student check-in result

An accepted check-in returns the immutable fact created by Bara:

```json
{
  "ok": true,
  "schema_version": 1,
  "outcome": "applied",
  "result_code": "check_in_accepted",
  "occurrence_ref": "occurrence_one",
  "session_revision": 2,
  "check_in": {
    "check_in_ref": "check_in_opaque",
    "participant_ref": "participant_one",
    "check_in_revision": 1,
    "accepted_at": "2026-09-02T12:51:00Z"
  }
}
```

An independent repeat while an active fact exists returns
`already_checked_in` and the original `accepted_at`. A transport retry with the
same idempotency key returns the stored result with outcome `duplicate`.

Rejected result codes are `not_on_roster`, `session_not_accepting`,
`invalid_check_in_token`, and `not_authorized`. A rejected request never creates
an attendance status or check-in fact.

### Check-in invalidation

Pika invalidates one or more known facts by `check_in_ref`:

```json
{
  "schema_version": 1,
  "message_type": "check_in.invalidate",
  "idempotency_key": "invalidate:one",
  "correlation_ref": "teacher_correction_one",
  "installation_ref": "installation_one",
  "roster_ref": "roster_one",
  "occurrence_ref": "occurrence_one",
  "actor_principal_ref": "principal_teacher",
  "actor_display_name": "Teacher One",
  "invalidations": [
    {
      "command_ref": "command_one",
      "check_in_ref": "check_in_opaque",
      "reason_code": "teacher_correction"
    }
  ]
}
```

Invalidation appends audit state; it never deletes the accepted timestamp. A
second invalidation is unchanged. Once invalidated, the participant may create
a new check-in fact if the occurrence is accepting scans.

## Events

Lifecycle events are:

- `attendance.session.scheduled`;
- `attendance.session.opened`;
- `attendance.session.closed`;
- `attendance.session.cancelled`.

Fact events are:

- `attendance.check_in.accepted`;
- `attendance.check_in.invalidated`.

Accepted metadata contains only `check_in_ref`, `participant_ref`,
`check_in_revision`, and `accepted_at`. Invalidated metadata additionally
contains `invalidated_at` and an optional bounded `reason_code`.

`attendance.record.changed`, `from_status`, and `to_status` are not part of
this contract.

## Reconciliation snapshot

The occurrence snapshot returns:

- the occurrence lifecycle status and revision;
- `accepts_at` and `stops_accepting_at`;
- every accepted check-in fact, including invalidated facts and their latest
  revision.

Pika upserts facts by `check_in_ref`. A delayed accepted event cannot override a
newer invalidation revision. Pika derives status from the accepted timestamp,
its frozen occurrence policy, current server time, and any teacher override.

## Authentication and idempotency

All HTTP requests retain the existing HMAC envelope, timestamp tolerance,
nonce replay protection, installation scoping, and constant-time signature
verification. Clock-skew tolerance authenticates transport only; it does not
alter `accepted_at`.

Each logical scan has a new idempotency key. Only uncertain transport retries
reuse it. Invalidations are idempotent as a batch and each command has its own
opaque `command_ref`.

## Deployment assumption

This contract is unreleased and has no external consumers. Pika and Bara update
it together; no legacy `attendance.marks` or status-event compatibility path is
required.
