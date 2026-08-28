// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import { api, internal } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workosClientId = process.env.WORKOS_CLIENT_ID ?? "client_test_bara";
const installationRef = "pika_test_installation";
const tenantRef = "pika_test_tenant";
const secret = "test-pika-integration-secret-with-at-least-32-characters";
const checkInToken = "test_check_in_token_123456789";
const ownerPrincipalRef = "principal_pika_owner";
const studentPrincipalRef = "principal_pika_student";
const ownerIdentity = {
  subject: "user_pika_owner",
  tokenIdentifier: "token-pika-owner",
  client_id: workosClientId,
  email: "owner@example.com",
  name: "Pika Owner",
};
const studentIdentity = {
  subject: "user_pika_student",
  tokenIdentifier: "token-pika-student",
  client_id: workosClientId,
  email: "student@example.com",
  name: "Pika Student",
};

function rosterSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    message_type: "roster.snapshot",
    idempotency_key: "roster:one:revision:1",
    correlation_ref: "correlation_roster_one",
    installation_ref: installationRef,
    roster_ref: "roster_one",
    tenant_ref: tenantRef,
    revision: 1,
    owner_principal_ref: ownerPrincipalRef,
    owner_display_name: ownerIdentity.name,
    display_name: "Period 1",
    participants: [
      {
        participant_ref: "participant_one",
        display_name: "Ada Lovelace",
        active: true,
        principal_ref: studentPrincipalRef,
      },
    ],
    ...overrides,
  };
}

function scheduleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    message_type: "schedule.snapshot",
    idempotency_key: "schedule:one:revision:1",
    correlation_ref: "correlation_schedule_one",
    installation_ref: installationRef,
    roster_ref: "roster_one",
    revision: 1,
    timezone: "America/Toronto",
    window_start: "2026-09-01",
    window_end: "2026-09-30",
    occurrences: [
      {
        occurrence_ref: "occurrence_one",
        date: "2026-09-02",
        title: "Period 1 attendance",
        accepts_at: "2026-09-02T12:50:00Z",
        stops_accepting_at: "2026-09-02T13:20:00Z",
      },
      {
        occurrence_ref: "occurrence_two",
        date: "2026-09-03",
        title: "Period 1 attendance",
        accepts_at: "2026-09-03T12:50:00Z",
        stops_accepting_at: "2026-09-03T13:20:00Z",
      },
    ],
    ...overrides,
  };
}

function sessionCommand(
  command: "open" | "close",
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version: 1,
    message_type: "session.command",
    idempotency_key: `session:occurrence_one:${command}:one`,
    correlation_ref: `correlation_session_${command}`,
    installation_ref: installationRef,
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    command,
    actor_principal_ref: ownerPrincipalRef,
    actor_display_name: ownerIdentity.name,
    ...overrides,
  };
}

function checkInInvalidations(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    message_type: "check_in.invalidate",
    idempotency_key: "check-in-invalidate:occurrence_one:one",
    correlation_ref: "correlation_check_in_invalidate_one",
    installation_ref: installationRef,
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    actor_principal_ref: ownerPrincipalRef,
    actor_display_name: ownerIdentity.name,
    invalidations: [
      {
        command_ref: "invalidate_check_in_one",
        check_in_ref: "check_in_one",
      },
    ],
    ...overrides,
  };
}

function checkInPresentation(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    message_type: "check_in.presentation",
    idempotency_key: "check-in:occurrence_one:one",
    correlation_ref: "correlation_check_in_one",
    installation_ref: installationRef,
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    actor_principal_ref: ownerPrincipalRef,
    actor_display_name: ownerIdentity.name,
    ...overrides,
  };
}

function studentCheckIn(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    message_type: "student_check_in",
    idempotency_key: "student-check-in:occurrence_one:student_one",
    correlation_ref: "correlation_student_check_in_one",
    installation_ref: installationRef,
    roster_ref: "roster_one",
    occurrence_ref: "occurrence_one",
    check_in_token: checkInToken,
    actor_principal_ref: studentPrincipalRef,
    actor_display_name: studentIdentity.name,
    ...overrides,
  };
}

function makeTest() {
  return convexTest(schema, modules);
}

async function configureDeterministicCheckInToken(t: ReturnType<typeof makeTest>) {
  await t.run(async (ctx) => {
    const sessions = await ctx.db.query("sessions").collect();
    const session = sessions.at(-1);
    if (!session) throw new Error("Expected an attendance session.");
    await ctx.db.patch(session._id, { checkInToken });
  });
}

async function signedRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof rosterSnapshot>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
  bodyOverride?: string,
) {
  const path = `/api/integrations/pika/v1/rosters/${payload.roster_ref}`;
  const body = bodyOverride ?? JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "PUT",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedScheduleRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof scheduleSnapshot>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/schedules/${payload.roster_ref}`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "PUT",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedCommandRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof sessionCommand>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/sessions/${payload.occurrence_ref}/commands`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "POST",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedInvalidationsRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof checkInInvalidations>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/sessions/${payload.occurrence_ref}/check-in-invalidations`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "POST",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedCheckInPresentationRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof checkInPresentation>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/sessions/${payload.occurrence_ref}/check-in`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "POST",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedStudentCheckInRequest(
  t: ReturnType<typeof makeTest>,
  payload: ReturnType<typeof studentCheckIn>,
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/sessions/${payload.occurrence_ref}/student-check-ins`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "POST",
    path,
    timestamp,
    nonce,
    body,
  });
  return t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
    body,
  });
}

async function signedSnapshotRequest(
  t: ReturnType<typeof makeTest>,
  occurrenceRef = "occurrence_one",
  nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const path = `/api/integrations/pika/v1/sessions/${occurrenceRef}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "GET",
    path,
    timestamp,
    nonce,
    body: "",
  });
  return t.fetch(path, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": installationRef,
      "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": nonce,
      "X-Attendance-Signature": signature,
    },
  });
}

async function initializedTest() {
  const t = makeTest();
  const owner = t.withIdentity(ownerIdentity);
  const student = t.withIdentity(studentIdentity);
  const [ownerAppUser, studentAppUser] = await Promise.all([
    owner.mutation(api.appUsers.ensureCurrent, {}),
    student.mutation(api.appUsers.ensureCurrent, {}),
  ]);
  return { t, ownerAppUser, studentAppUser };
}

type BaraTestHarness = Awaited<ReturnType<typeof initializedTest>>["t"];

async function processNextDueOccurrence(t: BaraTestHarness, now: number) {
  const occurrenceId = await t.run(async (ctx) => {
    const occurrences = await ctx.db.query("attendance_occurrences").collect();
    return occurrences.find((occurrence) =>
      (occurrence.status === "scheduled" && occurrence.opensAt <= now) ||
      (occurrence.status === "open" && occurrence.closesAt <= now)
    )?._id;
  });
  if (!occurrenceId) throw new Error("Expected a due attendance occurrence.");
  return await t.mutation(internal.pikaIntegration.processOccurrenceAutomation, {
    occurrenceId,
    now,
  });
}

describe("Pika attendance integration v1 roster adapter", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", workosClientId);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("asks Pika to retry while the integration adapter is disabled", async () => {
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");

    const response = await signedRequest(makeTest(), rosterSnapshot());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "temporarily_unavailable",
    });
  });

  it("keeps Pika principals separate from matching standalone WorkOS users", async () => {
    const { t, ownerAppUser, studentAppUser } = await initializedTest();
    const response = await signedRequest(t, rosterSnapshot());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "applied",
      roster_ref: "roster_one",
      revision: 1,
      created_count: 1,
      updated_count: 0,
      deactivated_count: 0,
    });

    await t.run(async (ctx) => {
      const rosterMapping = await ctx.db
        .query("pika_integrated_rosters")
        .withIndex("by_installationRef_and_rosterRef", (q) =>
          q.eq("installationRef", installationRef).eq("rosterRef", "roster_one"),
        )
        .unique();
      expect(rosterMapping?.ownerAppUserId).not.toBe(ownerAppUser._id);

      const ownerPikaIdentity = await ctx.db
        .query("auth_identities")
        .withIndex("by_provider_and_providerSubject", (q) =>
          q
            .eq("provider", "pika")
            .eq("providerSubject", `pika:${installationRef}:${ownerPrincipalRef}`),
        )
        .unique();
      expect(ownerPikaIdentity?.appUserId).toBe(rosterMapping?.ownerAppUserId);

      const participantMapping = await ctx.db
        .query("pika_integrated_participants")
        .withIndex("by_installationRef_rosterRef_participantRef", (q) =>
          q
            .eq("installationRef", installationRef)
            .eq("rosterRef", "roster_one")
            .eq("participantRef", "participant_one"),
        )
        .unique();
      const participant = participantMapping
        ? await ctx.db.get(participantMapping.participantId)
        : null;
      expect(participant).toMatchObject({
        displayName: "Ada Lovelace",
        linkMethod: "integration_assertion",
        linkStatus: "linked",
        active: true,
      });
      expect(participant?.linkedAppUserId).not.toBe(studentAppUser._id);
      const studentPikaIdentity = await ctx.db
        .query("auth_identities")
        .withIndex("by_provider_and_providerSubject", (q) =>
          q
            .eq("provider", "pika")
            .eq("providerSubject", `pika:${installationRef}:${studentPrincipalRef}`),
        )
        .unique();
      expect(studentPikaIdentity?.appUserId).toBe(participant?.linkedAppUserId);
    });
  });

  it("keeps the same opaque principal separate across installations", async () => {
    const t = makeTest();
    const payloadFor = (otherInstallationRef: string, suffix: string) => ({
      schema_version: 1 as const,
      message_type: "roster.snapshot" as const,
      idempotency_key: `roster:${suffix}:revision:1`,
      correlation_ref: `correlation_${suffix}`,
      installation_ref: otherInstallationRef,
      roster_ref: `roster_${suffix}`,
      tenant_ref: `tenant_${suffix}`,
      revision: 1,
      owner_principal_ref: "principal_shared_owner",
      owner_display_name: "Shared Owner",
      display_name: `Roster ${suffix}`,
      participants: [],
    });

    for (const [otherInstallationRef, suffix] of [
      ["pika_installation_one", "one"],
      ["pika_installation_two", "two"],
    ] as const) {
      const result = await t.mutation(internal.pikaIntegration.applyRosterSnapshot, {
        nonce: `nonce_${suffix}_12345678901234567890`,
        requestTimestamp: Math.floor(Date.now() / 1000),
        bodyDigest: suffix.repeat(64).slice(0, 64),
        payload: payloadFor(otherInstallationRef, suffix),
      });
      expect(result.ok).toBe(true);
    }

    await t.run(async (ctx) => {
      const identities = await ctx.db
        .query("auth_identities")
        .withIndex("by_provider_and_providerSubject", (q) => q.eq("provider", "pika"))
        .collect();
      expect(identities).toHaveLength(2);
      expect(new Set(identities.map((identity) => identity.appUserId)).size).toBe(2);
      expect(new Set(identities.map((identity) => identity.providerSubject))).toEqual(
        new Set([
          "pika:pika_installation_one:principal_shared_owner",
          "pika:pika_installation_two:principal_shared_owner",
        ]),
      );
      expect(await ctx.db.query("organizations").collect()).toHaveLength(2);
    });
  });

  it("returns the stored result for an idempotent retry and rejects nonce replay", async () => {
    const { t } = await initializedTest();
    const payload = rosterSnapshot();
    const replayedNonce = "nonce_replay_request_12345";

    expect((await signedRequest(t, payload, replayedNonce)).status).toBe(200);
    const replay = await signedRequest(t, payload, replayedNonce);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({ ok: false, code: "replayed_request" });

    const retry = await signedRequest(t, payload);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ ok: true, outcome: "duplicate" });

    await t.run(async (ctx) => {
      expect(await ctx.db.query("rosters").collect()).toHaveLength(1);
      expect(await ctx.db.query("participants").collect()).toHaveLength(1);
    });
  });

  it("applies only increasing revisions and deactivates removed participants", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);

    const stale = await signedRequest(t, rosterSnapshot({ idempotency_key: "roster:stale" }));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ ok: false, code: "stale_revision" });

    const revisionTwo = rosterSnapshot({
      idempotency_key: "roster:one:revision:2",
      revision: 2,
      display_name: "Period 1 updated",
      participants: [],
    });
    const updated = await signedRequest(t, revisionTwo);
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      ok: true,
      revision: 2,
      deactivated_count: 1,
    });

    await t.run(async (ctx) => {
      const participant = (await ctx.db.query("participants").collect())[0];
      expect(participant?.active).toBe(false);
    });
  });

  it("rejects tenant reassignment and never silently relinks an existing participant", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);
    const originalLinkedAppUserId = await t.run(async (ctx) =>
      (await ctx.db.query("participants").collect())[0]?.linkedAppUserId,
    );

    const tenantMismatch = await signedRequest(t, rosterSnapshot({
      idempotency_key: "roster:tenant-mismatch",
      tenant_ref: "another_tenant",
      revision: 2,
    }));
    expect(tenantMismatch.status).toBe(403);
    await expect(tenantMismatch.json()).resolves.toEqual({ ok: false, code: "owner_mismatch" });

    const otherIdentity = {
      subject: "user_pika_student_other",
      tokenIdentifier: "token-pika-student-other",
      client_id: workosClientId,
      name: "Other Student",
    };
    const other = t.withIdentity(otherIdentity);
    await other.mutation(api.appUsers.ensureCurrent, {});
    const relink = await signedRequest(t, rosterSnapshot({
      idempotency_key: "roster:relink-attempt",
      revision: 2,
      participants: [{
        participant_ref: "participant_one",
        display_name: "Ada Lovelace",
        active: true,
        principal_ref: "principal_pika_student_other",
      }],
    }));
    expect(relink.status).toBe(200);

    await t.run(async (ctx) => {
      expect(await ctx.db.query("pika_installation_tenants").collect()).toHaveLength(1);
      const participant = (await ctx.db.query("participants").collect())[0];
      expect(participant).toMatchObject({
        linkedAppUserId: originalLinkedAppUserId,
        linkStatus: "review_needed",
      });
    });
  });

  it("rejects tampering and narrowly provisions a Pika-only owner without admin access", async () => {
    const { t } = await initializedTest();
    const payload = rosterSnapshot();
    const signedBody = JSON.stringify(payload);
    const tamperedBody = JSON.stringify({ ...payload, display_name: "Tampered" });
    const path = "/api/integrations/pika/v1/rosters/roster_one";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce_tampered_request_12345";
    const signature = await createV1RequestSignature({
      secret,
      method: "PUT",
      path,
      timestamp,
      nonce,
      body: signedBody,
    });
    const tampered = await t.fetch(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Attendance-Installation-Ref": installationRef,
        "X-Attendance-Timestamp": timestamp,
        "X-Attendance-Nonce": nonce,
        "X-Attendance-Signature": signature,
      },
      body: tamperedBody,
    });
    expect(tampered.status).toBe(401);

    await t.run(async (ctx) => {
      expect(await ctx.db.query("rosters").collect()).toHaveLength(0);
      expect(await ctx.db.query("participants").collect()).toHaveLength(0);
    });

    const provisionedOwner = await signedRequest(
      t,
      rosterSnapshot({
        idempotency_key: "roster:pika-only-owner",
        owner_principal_ref: "principal_pika_only_owner",
        owner_display_name: "Pika Only Owner",
      }),
    );
    expect(provisionedOwner.status).toBe(200);

    await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("auth_identities")
        .withIndex("by_provider_and_providerSubject", (q) =>
          q
            .eq("provider", "pika")
            .eq("providerSubject", `pika:${installationRef}:principal_pika_only_owner`),
        )
        .unique();
      expect(identity?.provisionedByInstallationRef).toBe(installationRef);
      const memberships = identity
        ? await ctx.db
            .query("organization_memberships")
            .withIndex("by_appUserId_status", (q) =>
              q.eq("appUserId", identity.appUserId).eq("status", "active"),
            )
            .collect()
        : [];
      expect(memberships.map((membership) => membership.role)).toContain("staff");
      expect(memberships.map((membership) => membership.role)).not.toContain("admin");
    });
  });
});

describe("Pika attendance integration v1 schedule adapter", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", workosClientId);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("materializes concrete occurrence windows and atomically queues privacy-safe events", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);

    const response = await signedScheduleRequest(t, scheduleSnapshot());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "applied",
      roster_ref: "roster_one",
      revision: 1,
      scheduled_count: 2,
      updated_count: 0,
      cancelled_count: 0,
      preserved_count: 0,
    });

    await t.run(async (ctx) => {
      const occurrences = await ctx.db.query("attendance_occurrences").collect();
      expect(occurrences).toHaveLength(2);
      expect(occurrences.every((occurrence) => occurrence.status === "scheduled")).toBe(true);

      const events = await ctx.db.query("pika_outbox").collect();
      expect(events).toHaveLength(2);
      for (const event of events) {
        const payload = JSON.parse(event.payloadJson) as unknown;
        expect(validateV1Event(payload)).toMatchObject({ ok: true });
        expect(event.payloadJson).not.toContain("Ada Lovelace");
        expect(event.payloadJson).not.toContain("Period 1 attendance");
        expect(payload).toMatchObject({
          correlation_ref: "correlation_schedule_one",
          event_type: "attendance.session.scheduled",
        });
      }
    });
  });

  it("schedules exact open and close jobs while retaining the recovery sweep", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("PIKA_DISABLE_IMMEDIATE_DISPATCH", "true");
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(t, scheduleSnapshot())).status).toBe(200);

    await t.run(async (ctx) => {
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      expect(scheduled).toHaveLength(4);
      expect(scheduled.map((job) => job.name)).toEqual([
        "pikaIntegration:processOccurrenceAutomation",
        "pikaIntegration:processOccurrenceAutomation",
        "pikaIntegration:processOccurrenceAutomation",
        "pikaIntegration:processOccurrenceAutomation",
      ]);
    });
  });

  it("updates future windows, cancels removed sessions, and does not duplicate outbox events", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(t, scheduleSnapshot())).status).toBe(200);

    const revisionTwo = scheduleSnapshot({
      idempotency_key: "schedule:one:revision:2",
      correlation_ref: "correlation_schedule_two",
      revision: 2,
      occurrences: [
        {
          occurrence_ref: "occurrence_one",
          date: "2026-09-02",
          title: "Period 1 attendance",
          accepts_at: "2026-09-02T13:00:00Z",
          stops_accepting_at: "2026-09-02T13:30:00Z",
        },
      ],
    });
    const update = await signedScheduleRequest(t, revisionTwo);
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      ok: true,
      scheduled_count: 0,
      updated_count: 1,
      cancelled_count: 1,
    });

    const retry = await signedScheduleRequest(t, revisionTwo);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ ok: true, outcome: "duplicate" });

    await t.run(async (ctx) => {
      const occurrences = await ctx.db.query("attendance_occurrences").collect();
      expect(occurrences.find((occurrence) => occurrence.date === "2026-09-02")).toMatchObject({
        opensAt: Date.parse("2026-09-02T13:00:00Z"),
        status: "scheduled",
        sessionRevision: 2,
      });
      expect(occurrences.find((occurrence) => occurrence.date === "2026-09-03")).toMatchObject({
        status: "cancelled",
        sessionRevision: 2,
      });
      expect(await ctx.db.query("pika_outbox").collect()).toHaveLength(4);
    });
  });

  it.each([
    ["at", "2026-09-02T12:50:00.000Z"],
    ["after", "2026-09-02T12:51:00.000Z"],
  ])("preserves a due omitted occurrence %s its inclusive opening boundary", async (boundary, now) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(t, scheduleSnapshot())).status).toBe(200);

    const [, futureOccurrence] = scheduleSnapshot().occurrences;
    const removal = await signedScheduleRequest(t, scheduleSnapshot({
      idempotency_key: `schedule:one:revision:2:${boundary}`,
      correlation_ref: `correlation_schedule_due_removal_${boundary}`,
      revision: 2,
      occurrences: [futureOccurrence],
    }));
    expect(removal.status).toBe(200);
    await expect(removal.json()).resolves.toMatchObject({
      ok: true,
      cancelled_count: 0,
      preserved_count: 2,
    });

    const presentation = await signedCheckInPresentationRequest(
      t,
      checkInPresentation({ idempotency_key: `check-in:due-removal:${boundary}` }),
    );
    expect(presentation.status).toBe(200);
    const token = String((await presentation.json()).check_in_path).split("/").at(-1);
    const checkIn = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: `student-check-in:due-removal:${boundary}`,
      correlation_ref: `correlation_student_check_in_due_removal_${boundary}`,
      check_in_token: token,
    }));
    expect(checkIn.status).toBe(200);
    await expect(checkIn.json()).resolves.toMatchObject({
      outcome: "applied",
      result_code: "check_in_accepted",
    });

    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())
        .find((candidate) => candidate.date === "2026-09-02");
      expect(occurrence).toMatchObject({ status: "open", sessionRevision: 2 });
      expect((await ctx.db.query("pika_outbox").collect()).filter(
        (event) => event.eventType === "attendance.session.cancelled",
      )).toHaveLength(0);
    });
  });

  it("preserves open history when a later desired-state snapshot removes it", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(t, scheduleSnapshot())).status).toBe(200);

    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect()).find(
        (candidate) => candidate.date === "2026-09-02",
      );
      if (!occurrence) throw new Error("Expected occurrence.");
      await ctx.db.patch(occurrence._id, { status: "open" });
    });

    const removal = await signedScheduleRequest(t, scheduleSnapshot({
      idempotency_key: "schedule:one:revision:2",
      revision: 2,
      occurrences: [],
    }));
    expect(removal.status).toBe(200);
    await expect(removal.json()).resolves.toMatchObject({
      ok: true,
      cancelled_count: 1,
      preserved_count: 1,
    });

    await t.run(async (ctx) => {
      const openOccurrence = (await ctx.db.query("attendance_occurrences").collect()).find(
        (candidate) => candidate.date === "2026-09-02",
      );
      expect(openOccurrence?.status).toBe("open");
    });
  });

  it("requires an established roster mapping before accepting scheduling intent", async () => {
    const { t } = await initializedTest();
    const response = await signedScheduleRequest(t, scheduleSnapshot());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "roster_not_found" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("attendance_occurrences").collect()).toHaveLength(0);
      expect(await ctx.db.query("pika_outbox").collect()).toHaveLength(0);
    });
  });
});

describe("Pika attendance integration v1 session commands", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", workosClientId);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  });

  afterEach(() => vi.unstubAllEnvs());

  async function scheduledTest() {
    const initialized = await initializedTest();
    expect((await signedRequest(initialized.t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(initialized.t, scheduleSnapshot())).status).toBe(200);
    return initialized;
  }

  it("opens and closes QR acceptance without creating attendance statuses", async () => {
    const { t } = await scheduledTest();
    const open = await signedCommandRequest(t, sessionCommand("open"));
    expect(open.status).toBe(200);
    await expect(open.json()).resolves.toEqual({
      ok: true,
      outcome: "applied",
      occurrence_ref: "occurrence_one",
      status: "open",
      session_revision: 2,
    });

    await t.run(async (ctx) => {
      const sessions = await ctx.db.query("sessions").collect();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ status: "open", participantMode: "verified" });
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);
    });

    const close = await signedCommandRequest(t, sessionCommand("close"));
    expect(close.status).toBe(200);
    await expect(close.json()).resolves.toEqual({
      ok: true,
      outcome: "applied",
      occurrence_ref: "occurrence_one",
      status: "closed",
      session_revision: 3,
    });

    await t.run(async (ctx) => {
      const session = (await ctx.db.query("sessions").collect())[0];
      expect(session?.status).toBe("closed");
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);

      const outbox = await ctx.db.query("pika_outbox").collect();
      expect(outbox.map((event) => event.eventType)).toContain("attendance.session.opened");
      expect(outbox.map((event) => event.eventType)).toContain("attendance.session.closed");
      expect(outbox.map((event) => event.eventType)).not.toContain(
        "attendance.check_in.accepted",
      );
    });
  });

  it("makes command retries idempotent and repeated desired state unchanged", async () => {
    const { t } = await scheduledTest();
    const command = sessionCommand("open");
    expect((await signedCommandRequest(t, command)).status).toBe(200);

    const retry = await signedCommandRequest(t, command);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ ok: true, outcome: "duplicate" });

    const unchanged = await signedCommandRequest(t, sessionCommand("open", {
      idempotency_key: "session:occurrence_one:open:two",
      correlation_ref: "correlation_session_open_two",
    }));
    expect(unchanged.status).toBe(200);
    await expect(unchanged.json()).resolves.toMatchObject({ ok: true, outcome: "unchanged" });

    await t.run(async (ctx) => {
      expect(await ctx.db.query("sessions").collect()).toHaveLength(1);
      const openedEvents = (await ctx.db.query("pika_outbox").collect()).filter(
        (event) => event.eventType === "attendance.session.opened",
      );
      expect(openedEvents).toHaveLength(1);
    });
  });

  it("independently rejects an actor who lacks application roster access", async () => {
    const { t } = await scheduledTest();
    const response = await signedCommandRequest(t, sessionCommand("open", {
      actor_principal_ref: studentPrincipalRef,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "actor_not_authorized" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("sessions").collect()).toHaveLength(0);
    });
  });

  it("narrowly provisions a Pika-only teacher as staff for the asserted roster", async () => {
    const { t } = await scheduledTest();
    const response = await signedCommandRequest(t, sessionCommand("open", {
      actor_principal_ref: "principal_pika_only_teacher",
      actor_display_name: "Pika Only Teacher",
    }));
    expect(response.status).toBe(200);

    await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("auth_identities")
        .withIndex("by_provider_and_providerSubject", (q) =>
          q
            .eq("provider", "pika")
            .eq("providerSubject", `pika:${installationRef}:principal_pika_only_teacher`),
        )
        .unique();
      const memberships = identity
        ? await ctx.db
            .query("organization_memberships")
            .withIndex("by_appUserId_status", (q) =>
              q.eq("appUserId", identity.appUserId).eq("status", "active"),
            )
            .collect()
        : [];
      expect(memberships.map((membership) => membership.role)).toEqual(["staff"]);
      expect(await ctx.db.query("roster_access").collect()).toHaveLength(2);
    });
  });
});

describe("Pika attendance integration v1 check-in facts", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", workosClientId);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function openTest() {
    const initialized = await initializedTest();
    expect((await signedRequest(initialized.t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(initialized.t, scheduleSnapshot())).status).toBe(200);
    expect((await signedCommandRequest(initialized.t, sessionCommand("open"))).status).toBe(200);
    await configureDeterministicCheckInToken(initialized.t);
    return initialized;
  }

  it("opens atomically at the inclusive acceptance boundary before the scheduled worker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-02T12:50:00.000Z");
    const initialized = await initializedTest();
    expect((await signedRequest(initialized.t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(initialized.t, scheduleSnapshot())).status).toBe(200);

    const presentation = await signedCheckInPresentationRequest(
      initialized.t,
      checkInPresentation({ idempotency_key: "check-in:boundary:one" }),
    );
    expect(presentation.status).toBe(200);
    const presentationBody = await presentation.json();
    const token = String(presentationBody.check_in_path).split("/").at(-1);
    const checkIn = await signedStudentCheckInRequest(initialized.t, studentCheckIn({
      idempotency_key: "student-check-in:boundary:one",
      correlation_ref: "correlation_student_check_in_boundary",
      check_in_token: token,
    }));
    expect(checkIn.status).toBe(200);
    await expect(checkIn.json()).resolves.toMatchObject({
      outcome: "applied",
      result_code: "check_in_accepted",
      session_revision: 2,
    });

    await initialized.t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())
        .find((candidate) => candidate.date === "2026-09-02");
      expect(occurrence).toMatchObject({ status: "open", sessionRevision: 2 });
      expect((await ctx.db.query("pika_check_ins").collect())).toHaveLength(1);
      expect((await ctx.db.query("pika_outbox").collect()).filter(
        (event) => event.eventType === "attendance.session.opened",
      )).toHaveLength(1);
    });
  });

  it("invalidates an accepted check-in without deleting its timestamp", async () => {
    const { t } = await openTest();
    const acceptedResponse = await signedStudentCheckInRequest(t, studentCheckIn());
    const accepted = await acceptedResponse.json();
    const checkInRef = accepted.check_in.check_in_ref as string;
    const payload = checkInInvalidations({
      invalidations: [{
        command_ref: "invalidate_check_in_one",
        check_in_ref: checkInRef,
        reason_code: "teacher_correction",
      }],
    });
    const response = await signedInvalidationsRequest(t, payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "applied",
      occurrence_ref: "occurrence_one",
      session_revision: 2,
      applied_count: 1,
      unchanged_count: 0,
    });

    const retry = await signedInvalidationsRequest(t, payload);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      ok: true,
      outcome: "duplicate",
      applied_count: 1,
    });

    await t.run(async (ctx) => {
      const checkIn = (await ctx.db.query("pika_check_ins").collect())[0];
      expect(checkIn).toMatchObject({
        checkInRef,
        checkInRevision: 2,
        reasonCode: "teacher_correction",
      });
      expect(checkIn?.invalidatedAt).toBeTypeOf("number");
      const invalidationEvents = (await ctx.db.query("pika_outbox").collect()).filter(
        (event) => event.eventType === "attendance.check_in.invalidated",
      );
      expect(invalidationEvents).toHaveLength(1);
      expect(JSON.parse(invalidationEvents[0]!.payloadJson)).toMatchObject({
        correlation_ref: "correlation_check_in_invalidate_one",
        session_revision: 2,
        metadata: {
          check_in_ref: checkInRef,
          participant_ref: "participant_one",
          check_in_revision: 2,
          reason_code: "teacher_correction",
        },
      });
      expect(invalidationEvents[0]!.payloadJson).not.toContain("Ada Lovelace");
    });
  });

  it("allows invalidation after close and a new scan after invalidation when open", async () => {
    const { t } = await openTest();
    const first = await (await signedStudentCheckInRequest(t, studentCheckIn())).json();
    const invalidate = checkInInvalidations({
      invalidations: [{
        command_ref: "invalidate_first",
        check_in_ref: first.check_in.check_in_ref,
      }],
    });
    expect((await signedInvalidationsRequest(t, invalidate)).status).toBe(200);

    const second = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:occurrence_one:student_one:second",
    }));
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({
      outcome: "applied",
      result_code: "check_in_accepted",
    });
    expect((await signedCommandRequest(t, sessionCommand("close"))).status).toBe(200);
    const invalidateAfterClose = await signedInvalidationsRequest(t, checkInInvalidations({
      idempotency_key: "check-in-invalidate:occurrence_one:two",
      invalidations: [{
        command_ref: "invalidate_second",
        check_in_ref: secondBody.check_in.check_in_ref,
      }],
    }));
    expect(invalidateAfterClose.status).toBe(200);

    await t.run(async (ctx) => {
      const checkIns = await ctx.db.query("pika_check_ins").collect();
      expect(checkIns).toHaveLength(2);
      expect(checkIns.every((checkIn) => checkIn.invalidatedAt !== undefined)).toBe(true);
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);
    });
  });

  it("rejects an unknown check-in before invalidating any item in the batch", async () => {
    const { t } = await openTest();
    const accepted = await (await signedStudentCheckInRequest(t, studentCheckIn())).json();
    const response = await signedInvalidationsRequest(t, checkInInvalidations({
      invalidations: [
        {
          command_ref: "invalidate_known",
          check_in_ref: accepted.check_in.check_in_ref,
        },
        {
          command_ref: "invalidate_unknown",
          check_in_ref: "check_in_unknown",
        },
      ],
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "check_in_not_found" });

    await t.run(async (ctx) => {
      expect((await ctx.db.query("pika_check_ins").collect())[0]?.invalidatedAt).toBeUndefined();
      const invalidations = (await ctx.db.query("pika_outbox").collect()).filter(
        (event) => event.eventType === "attendance.check_in.invalidated",
      );
      expect(invalidations).toHaveLength(0);
    });
  });

  it("returns an authoritative reconciliation snapshot without internal IDs or roster PII", async () => {
    const { t } = await openTest();
    const accepted = await (await signedStudentCheckInRequest(t, studentCheckIn())).json();

    const snapshotNonce = "nonce_snapshot_replay_12345";
    const response = await signedSnapshotRequest(t, "occurrence_one", snapshotNonce);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      schema_version: 1,
      occurrence_ref: "occurrence_one",
      roster_ref: "roster_one",
      session_revision: 2,
      status: "open",
      accepts_at: "2026-09-02T12:50:00.000Z",
      stops_accepting_at: "2026-09-02T13:20:00.000Z",
      check_ins: [{
        check_in_ref: accepted.check_in.check_in_ref,
        participant_ref: "participant_one",
        check_in_revision: 1,
        accepted_at: accepted.check_in.accepted_at,
      }],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Ada Lovelace");
    expect(serialized).not.toContain("checkInToken");
    expect(serialized).not.toContain("_id");

    const replay = await signedSnapshotRequest(t, "occurrence_one", snapshotNonce);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      code: "replayed_request",
    });

    const missing = await signedSnapshotRequest(t, "occurrence_missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      code: "occurrence_not_found",
    });
  });

  it("returns only an authorized open session's bounded check-in presentation", async () => {
    const { t } = await openTest();
    const presentationNonce = "nonce_presentation_replay_12345";
    const response = await signedCheckInPresentationRequest(
      t,
      checkInPresentation(),
      presentationNonce,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      schema_version: 1,
      occurrence_ref: "occurrence_one",
      session_revision: 2,
      valid_until: "2026-09-02T13:20:00.000Z",
    });
    expect(body.check_in_path).toMatch(/^\/check-in\/[A-Za-z0-9._~-]{20,128}$/);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Ada Lovelace");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("_id");

    const replay = await signedCheckInPresentationRequest(
      t,
      checkInPresentation(),
      presentationNonce,
    );
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      code: "replayed_request",
    });

    const expired = await t.mutation(internal.pikaIntegration.getCheckInPresentation, {
      installationRef,
      rosterRef: "roster_one",
      occurrenceRef: "occurrence_one",
      actorPrincipalRef: ownerPrincipalRef,
      actorDisplayName: ownerIdentity.name,
      now: Date.parse("2026-09-02T13:20:00.000Z"),
    });
    expect(expired).toEqual({ ok: false, code: "invalid_session_state" });

    const unauthorized = await signedCheckInPresentationRequest(t, checkInPresentation({
      actor_principal_ref: studentPrincipalRef,
    }));
    expect(unauthorized.status).toBe(403);

    expect((await signedCommandRequest(t, sessionCommand("close"))).status).toBe(200);
    const closed = await signedCheckInPresentationRequest(t, checkInPresentation());
    expect(closed.status).toBe(409);
    await expect(closed.json()).resolves.toEqual({
      ok: false,
      code: "invalid_session_state",
    });
  });

  it("returns the authoritative student result synchronously and replays a lost response safely", async () => {
    const { t } = await openTest();
    const payload = studentCheckIn();
    const response = await signedStudentCheckInRequest(t, payload);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      schema_version: 1,
      outcome: "applied",
      result_code: "check_in_accepted",
      occurrence_ref: "occurrence_one",
      session_revision: 2,
      check_in: {
        check_in_ref: expect.stringMatching(/^check_in_[a-f0-9]{64}$/),
        participant_ref: "participant_one",
        check_in_revision: 1,
        accepted_at: expect.stringMatching(/Z$/),
      },
    });

    const retry = await signedStudentCheckInRequest(t, payload);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      ok: true,
      outcome: "duplicate",
      result_code: "check_in_accepted",
      check_in: {
        check_in_ref: body.check_in.check_in_ref,
        check_in_revision: 1,
        accepted_at: body.check_in.accepted_at,
      },
    });

    await t.run(async (ctx) => {
      const checkIns = await ctx.db.query("pika_check_ins").collect();
      expect(checkIns).toHaveLength(1);
      expect(checkIns[0]).toMatchObject({
        checkInRef: body.check_in.check_in_ref,
        checkInRevision: 1,
      });
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);
      const studentEvents = (await ctx.db.query("pika_outbox").collect())
        .filter((event) => event.eventType === "attendance.check_in.accepted")
        .map((event) => JSON.parse(event.payloadJson) as Record<string, unknown>)
        .filter((event) => event.correlation_ref === "correlation_student_check_in_one");
      expect(studentEvents).toHaveLength(1);
      expect(studentEvents[0]).toMatchObject({
        metadata: {
          check_in_ref: body.check_in.check_in_ref,
          participant_ref: "participant_one",
          check_in_revision: 1,
          accepted_at: body.check_in.accepted_at,
        },
      });
    });
  });

  it("fails closed when a participant identity link requires review", async () => {
    const { t } = await openTest();
    const relink = await signedRequest(t, rosterSnapshot({
      idempotency_key: "roster:relink-after-open",
      revision: 2,
      participants: [{
        participant_ref: "participant_one",
        display_name: "Ada Lovelace",
        active: true,
        principal_ref: "principal_pika_student_other",
      }],
    }));
    expect(relink.status).toBe(200);

    const response = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:conflicted-link",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      outcome: "rejected",
      result_code: "not_on_roster",
    });

    const proposedPrincipalResponse = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:conflicted-link:proposed-principal",
      correlation_ref: "correlation_student_check_in_conflicted_proposed",
      actor_principal_ref: "principal_pika_student_other",
    }));
    expect(proposedPrincipalResponse.status).toBe(200);
    await expect(proposedPrincipalResponse.json()).resolves.toMatchObject({
      ok: true,
      outcome: "rejected",
      result_code: "not_on_roster",
    });

    await t.run(async (ctx) => {
      const participant = (await ctx.db.query("participants").collect())[0];
      expect(participant).toMatchObject({ linkStatus: "review_needed" });
      expect(await ctx.db.query("pika_check_ins").collect()).toHaveLength(0);
    });
  });

  it("returns closed and invalid student scan states without delayed writes", async () => {
    const { t } = await openTest();
    const invalidToken = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:invalid-token",
      check_in_token: "invalid_check_in_token_12345",
    }));
    expect(invalidToken.status).toBe(200);
    await expect(invalidToken.json()).resolves.toMatchObject({
      ok: true,
      outcome: "rejected",
      result_code: "invalid_check_in_token",
    });

    expect((await signedCommandRequest(t, sessionCommand("close"))).status).toBe(200);

    const closed = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:closed",
    }));
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({
      ok: true,
      outcome: "rejected",
      result_code: "session_not_accepting",
      session_revision: 3,
    });

    const invalid = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:invalid",
      occurrence_ref: "occurrence_missing",
    }));
    expect(invalid.status).toBe(404);
    await expect(invalid.json()).resolves.toEqual({ ok: false, code: "occurrence_not_found" });
  });

  it("returns an authoritative unmatched result for a tenant-bound Pika-only student", async () => {
    const { t } = await initializedTest();
    expect((await signedRequest(t, rosterSnapshot({
      participants: [{
        participant_ref: "participant_one",
        display_name: "Ada Lovelace",
        active: true,
      }],
    }))).status).toBe(200);
    expect((await signedScheduleRequest(t, scheduleSnapshot())).status).toBe(200);
    expect((await signedCommandRequest(t, sessionCommand("open"))).status).toBe(200);
    await configureDeterministicCheckInToken(t);

    const response = await signedStudentCheckInRequest(t, studentCheckIn({
      idempotency_key: "student-check-in:unmatched",
      actor_principal_ref: "principal_pika_only_unmatched_student",
      actor_display_name: "Unmatched Student",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      outcome: "rejected",
      result_code: "not_on_roster",
    });
    expect(body).not.toHaveProperty("check_in");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("pika_check_ins").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("pika_outbox").collect()).filter(
          (event) => event.eventType === "attendance.check_in.accepted",
        ),
      ).toHaveLength(0);
    });
  });
});

describe("scheduled attendance automation", () => {
  beforeEach(() => {
    vi.stubEnv("WORKOS_CLIENT_ID", workosClientId);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", secret);
  });

  afterEach(() => vi.unstubAllEnvs());

  async function scheduledTest(payload = scheduleSnapshot()) {
    const initialized = await initializedTest();
    expect((await signedRequest(initialized.t, rosterSnapshot())).status).toBe(200);
    expect((await signedScheduleRequest(initialized.t, payload)).status).toBe(200);
    return initialized;
  }

  it("automatically opens and closes QR acceptance without deriving status", async () => {
    const { t } = await scheduledTest();
    const openResult = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T12:55:00Z"),
    );
    expect(openResult).toEqual({ opened: 1, closed: 0, cancelled: 0, deferred: 0 });

    const closeResult = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:25:00Z"),
    );
    expect(closeResult).toEqual({ opened: 0, closed: 1, cancelled: 0, deferred: 0 });

    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect()).find(
        (candidate) => candidate.date === "2026-09-02",
      );
      const session = (await ctx.db.query("sessions").collect())[0];
      expect(occurrence).toMatchObject({ status: "closed", sessionRevision: 3 });
      expect(session?.status).toBe("closed");
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);

      const events = await ctx.db.query("pika_outbox").collect();
      const opened = events.find((event) => event.eventType === "attendance.session.opened");
      const closed = events.find((event) => event.eventType === "attendance.session.closed");
      expect(JSON.parse(opened?.payloadJson ?? "{}")).toMatchObject({
        metadata: { trigger: "schedule" },
      });
      expect(JSON.parse(closed?.payloadJson ?? "{}")).toMatchObject({
        metadata: { trigger: "schedule" },
      });
      expect(events.map((event) => event.eventType)).not.toContain(
        "attendance.check_in.accepted",
      );
    });
  });

  it("cancels future intent while allowing an already-open occurrence to finalize", async () => {
    const { t } = await scheduledTest();
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T12:55:00Z"),
    )).toEqual({ opened: 1, closed: 0, cancelled: 0, deferred: 0 });

    const deactivation = await signedScheduleRequest(t, scheduleSnapshot({
      idempotency_key: "schedule:one:revision:2",
      correlation_ref: "correlation_schedule_deactivation",
      revision: 2,
      occurrences: [],
    }));
    expect(deactivation.status).toBe(200);
    await expect(deactivation.json()).resolves.toMatchObject({
      ok: true,
      cancelled_count: 1,
      preserved_count: 1,
    });

    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:25:00Z"),
    )).toEqual({ opened: 0, closed: 1, cancelled: 0, deferred: 0 });

    await t.run(async (ctx) => {
      const occurrences = await ctx.db.query("attendance_occurrences").collect();
      expect(occurrences.find((occurrence) => occurrence.date === "2026-09-02"))
        .toMatchObject({ status: "closed", sessionRevision: 3 });
      expect(occurrences.find((occurrence) => occurrence.date === "2026-09-03"))
        .toMatchObject({ status: "cancelled", sessionRevision: 2 });
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);
    });
  });

  it("pauses a due scheduled occurrence while the integration is disabled", async () => {
    const payload = scheduleSnapshot({
      occurrences: [scheduleSnapshot().occurrences[0]],
    });
    const { t } = await scheduledTest(payload);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");

    const paused = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T12:55:00Z"),
    );
    expect(paused).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 1 });

    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    const recovery = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:00:00Z"),
    );
    expect(recovery).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 0 });

    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      expect(occurrence).toMatchObject({
        status: "scheduled",
        automationPaused: true,
        lastAutomationErrorCode: "integration_paused",
      });
      expect(await ctx.db.query("sessions").collect()).toHaveLength(0);
    });

    expect((await signedCommandRequest(t, sessionCommand("open"))).status).toBe(200);
    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      expect(occurrence?.status).toBe("open");
      expect(occurrence).not.toHaveProperty("automationPaused");
      expect(occurrence).not.toHaveProperty("lastAutomationErrorCode");
    });
  });

  it("does not let a paused scheduled occurrence open after its window", async () => {
    const payload = scheduleSnapshot({
      occurrences: [scheduleSnapshot().occurrences[0]],
    });
    const { t } = await scheduledTest(payload);
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T14:00:00Z"),
    )).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 1 });

    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      if (!occurrence) throw new Error("Expected a paused occurrence.");
      await ctx.db.patch(occurrence._id, { closesAt: Date.now() - 1 });
    });
    const response = await signedCommandRequest(t, sessionCommand("open"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "invalid_session_state",
    });
    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      expect(occurrence).toMatchObject({ status: "scheduled", automationPaused: true });
      expect(await ctx.db.query("sessions").collect()).toHaveLength(0);
    });
  });

  it("does not finalize an open occurrence while the integration is disabled", async () => {
    const payload = scheduleSnapshot({
      occurrences: [scheduleSnapshot().occurrences[0]],
    });
    const { t } = await scheduledTest(payload);
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T12:55:00Z"),
    )).toEqual({ opened: 1, closed: 0, cancelled: 0, deferred: 0 });

    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");
    const paused = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:25:00Z"),
    );
    expect(paused).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 1 });

    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:30:00Z"),
    )).toEqual({ opened: 0, closed: 0, cancelled: 0, deferred: 0 });

    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      const session = (await ctx.db.query("sessions").collect())[0];
      expect(occurrence).toMatchObject({ status: "open", automationPaused: true });
      expect(session?.status).toBe("open");
      expect(await ctx.db.query("attendance_records").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("pika_outbox").collect()).some(
          (event) => event.eventType === "attendance.session.closed",
        ),
      ).toBe(false);
    });
  });

  it("creates unique deliverable events for maximum-length opaque occurrence references", async () => {
    const occurrenceRef = `occurrence_${"x".repeat(117)}`;
    expect(occurrenceRef).toHaveLength(128);
    const payload = scheduleSnapshot({
      occurrences: [{
        ...scheduleSnapshot().occurrences[0],
        occurrence_ref: occurrenceRef,
      }],
    });
    const { t } = await scheduledTest(payload);
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T12:55:00Z"),
    )).toMatchObject({ opened: 1 });
    expect(await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T13:25:00Z"),
    )).toMatchObject({ closed: 1 });

    const claimed = await t.mutation(internal.pikaOutboxModel.claim, {
      now: Date.parse("2026-09-03T00:00:00Z"),
      limit: 20,
    });
    expect(claimed.length).toBeGreaterThanOrEqual(3);
    expect(new Set(claimed.map((event) => event.eventId)).size).toBe(claimed.length);
    for (const event of claimed) {
      await expect(t.mutation(internal.pikaOutboxModel.complete, {
        eventId: event.eventId,
        leaseToken: event.leaseToken,
        now: Date.parse("2026-09-03T00:00:01Z"),
      })).resolves.toBe(true);
    }
  });

  it("cancels a missed window instead of opening attendance after its close time", async () => {
    const payload = scheduleSnapshot({
      occurrences: [scheduleSnapshot().occurrences[0]],
    });
    const { t } = await scheduledTest(payload);
    const result = await processNextDueOccurrence(
      t,
      Date.parse("2026-09-02T14:00:00Z"),
    );

    expect(result).toEqual({ opened: 0, closed: 0, cancelled: 1, deferred: 0 });
    await t.run(async (ctx) => {
      const occurrence = (await ctx.db.query("attendance_occurrences").collect())[0];
      expect(occurrence?.status).toBe("cancelled");
      const cancelled = (await ctx.db.query("pika_outbox").collect()).find(
        (event) => event.eventType === "attendance.session.cancelled",
      );
      expect(JSON.parse(cancelled?.payloadJson ?? "{}")).toMatchObject({
        metadata: { reason_code: "missed_window" },
      });
    });
  });

  it("paginates past 20 deferred opens so a later valid occurrence is not starved", async () => {
    vi.useFakeTimers();
    try {
      const occurrences = Array.from({ length: 21 }, (_, index) => ({
        occurrence_ref: `occurrence_page_${String(index).padStart(2, "0")}`,
        date: "2026-09-02",
        title: `Paged attendance ${index}`,
        accepts_at: new Date(Date.parse("2026-09-02T12:00:00Z") + index * 1_000).toISOString(),
        stops_accepting_at: "2026-09-02T14:00:00.000Z",
      }));
      const validOccurrenceRef = occurrences.at(-1)!.occurrence_ref;
      const { t } = await scheduledTest(scheduleSnapshot({ occurrences }));

      await t.run(async (ctx) => {
        const mappings = await ctx.db.query("pika_integrated_occurrences").collect();
        for (const mapping of mappings) {
          if (mapping.occurrenceRef !== validOccurrenceRef) await ctx.db.delete(mapping._id);
        }
      });

      expect(await t.mutation(internal.pikaIntegration.processDueOccurrences, {
        now: Date.parse("2026-09-02T13:00:00Z"),
      })).toEqual({
        queuedOpen: 20,
        queuedClose: 0,
        hasMoreOpen: true,
        hasMoreClose: false,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (ctx) => {
        const mappings = await ctx.db.query("pika_integrated_occurrences").collect();
        const validMapping = mappings.find(
          (mapping) => mapping.occurrenceRef === validOccurrenceRef,
        );
        expect(validMapping).toBeDefined();
        expect((await ctx.db.get(validMapping!.occurrenceId))?.status).toBe("open");
        const deferred = await ctx.db
          .query("attendance_occurrences")
          .filter((q) => q.eq(q.field("lastAutomationErrorCode"), "integration_mapping_missing"))
          .collect();
        expect(deferred).toHaveLength(20);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("paginates 21 due closes without finalizing a maximum roster", async () => {
    vi.useFakeTimers();
    try {
      const occurrences = Array.from({ length: 21 }, (_, index) => ({
        occurrence_ref: `occurrence_close_${String(index).padStart(2, "0")}`,
        date: "2026-09-02",
        title: `Close attendance ${index}`,
        accepts_at: "2026-09-02T12:00:00.000Z",
        stops_accepting_at: new Date(Date.parse("2026-09-02T13:00:00Z") + index * 1_000).toISOString(),
      }));
      const validOccurrenceRef = occurrences.at(-1)!.occurrence_ref;
      const { t } = await scheduledTest(scheduleSnapshot({ occurrences }));

      await t.run(async (ctx) => {
        const [participant] = await ctx.db.query("participants").collect();
        const mappings = await ctx.db.query("pika_integrated_occurrences").collect();
        const validMapping = mappings.find(
          (mapping) => mapping.occurrenceRef === validOccurrenceRef,
        );
        if (!participant || !validMapping) throw new Error("Expected seeded integration state.");
        const validOccurrence = await ctx.db.get(validMapping.occurrenceId);
        if (!validOccurrence) throw new Error("Expected valid occurrence.");
        const now = Date.parse("2026-09-02T12:30:00Z");
        const sessionId = await ctx.db.insert("sessions", {
          rosterId: validOccurrence.rosterId,
          title: validOccurrence.title,
          date: validOccurrence.date,
          sessionType: "recurring_class",
          participantMode: "verified",
          status: "open",
          createdByAppUserId: validOccurrence.createdByAppUserId,
          checkInToken: "close_worker_token_123456789",
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const participantIds = [participant._id];
        for (let index = 1; index < 500; index += 1) {
          participantIds.push(await ctx.db.insert("participants", {
            rosterId: validOccurrence.rosterId,
            rawName: `Student ${index}`,
            firstName: "Student",
            lastName: String(index),
            displayName: `Student ${index}`,
            sortKey: `${String(index).padStart(3, "0")}|student`,
            participantType: "roster_only",
            linkStatus: "unlinked",
            active: true,
            createdAt: now,
            updatedAt: now,
          }));
        }
        for (const participantId of participantIds) {
          await ctx.db.insert("attendance_records", {
            sessionId,
            participantId,
            linkedAppUserId:
              participantId === participant._id ? participant.linkedAppUserId : undefined,
            status: "unmarked",
            recordRevision: 0,
            modifiedAt: now,
          });
        }
        for (const mapping of mappings) {
          await ctx.db.patch(mapping.occurrenceId, {
            status: "open",
            sessionId: mapping.occurrenceRef === validOccurrenceRef ? sessionId : undefined,
          });
        }
      });

      expect(await t.mutation(internal.pikaIntegration.processDueOccurrences, {
        now: Date.parse("2026-09-02T14:00:00Z"),
      })).toEqual({
        queuedOpen: 0,
        queuedClose: 20,
        hasMoreOpen: false,
        hasMoreClose: true,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (ctx) => {
        const validMapping = (await ctx.db.query("pika_integrated_occurrences").collect()).find(
          (mapping) => mapping.occurrenceRef === validOccurrenceRef,
        );
        expect(validMapping).toBeDefined();
        expect((await ctx.db.get(validMapping!.occurrenceId))?.status).toBe("closed");
        const records = await ctx.db.query("attendance_records").collect();
        expect(records).toHaveLength(500);
        expect(records.every((record) => record.status === "unmarked")).toBe(true);
        const deferred = await ctx.db
          .query("attendance_occurrences")
          .filter((q) => q.eq(q.field("lastAutomationErrorCode"), "session_missing"))
          .collect();
        expect(deferred).toHaveLength(20);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
