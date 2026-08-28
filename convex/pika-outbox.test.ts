// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import { internalActions } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const installationRef = "pika_test_installation";
const deliverySecret = "test-pika-event-delivery-secret-at-least-32-characters";
const deliveryUrl = "https://pika.codepet.ca/api/integrations/attendance/v1/events";
const eventPayload = JSON.stringify({
  schema_version: 1,
  event_id: "event_occurrence_one_scheduled_1",
  event_type: "attendance.session.scheduled",
  correlation_ref: "correlation_schedule_one",
  installation_ref: installationRef,
  roster_ref: "roster_one",
  occurrence_ref: "occurrence_one",
  occurred_at: "2026-09-01T12:00:00Z",
  metadata: {
    session_revision: 1,
    accepts_at: "2026-09-02T12:50:00Z",
    stops_accepting_at: "2026-09-02T13:20:00Z",
  },
});

function makeTest() {
  return convexTest(schema, modules);
}

async function seedPendingEvent(t: ReturnType<typeof makeTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("pika_outbox", {
      installationRef,
      eventId: "event_occurrence_one_scheduled_1",
      eventType: "attendance.session.scheduled",
      correlationRef: "correlation_schedule_one",
      payloadJson: eventPayload,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedPendingEvents(t: ReturnType<typeof makeTest>, count: number) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      const eventId = `event_batch_${index}`;
      await ctx.db.insert("pika_outbox", {
        installationRef,
        eventId,
        eventType: "attendance.session.scheduled",
        correlationRef: `correlation_batch_${index}`,
        payloadJson: JSON.stringify({ ...JSON.parse(eventPayload), event_id: eventId }),
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: 0,
        createdAt: index + 1,
        updatedAt: index + 1,
      });
    }
  });
}

async function outboxRow(t: ReturnType<typeof makeTest>) {
  return t.run(async (ctx) => ctx.db.query("pika_outbox").first());
}

describe("Pika attendance event outbox delivery", () => {
  beforeEach(() => {
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_EVENT_DELIVERY_SECRET", deliverySecret);
    vi.stubEnv("PIKA_EVENT_DELIVERY_URL", deliveryUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("signs the exact event request and marks an accepted event delivered", async () => {
    const t = makeTest();
    await seedPendingEvent(t);

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const timestamp = headers.get("X-Attendance-Timestamp") ?? "";
      const nonce = headers.get("X-Attendance-Nonce") ?? "";
      const signature = headers.get("X-Attendance-Signature");
      expect(_input.toString()).toBe(deliveryUrl);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(headers.get("X-Attendance-Installation-Ref")).toBe(installationRef);
      expect(init?.body).toBe(eventPayload);
      await expect(
        verifyV1RequestSignature(
          {
            secret: deliverySecret,
            method: "POST",
            path: "/api/integrations/attendance/v1/events",
            timestamp,
            nonce,
            body: eventPayload,
          },
          signature,
        ),
      ).resolves.toBe(true);
      return new Response(
        JSON.stringify({ accepted: true, duplicate: false, projection_applied: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(t.action(internalActions.pikaOutbox.deliver, { limit: 5 })).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      failed: 0,
      disabled: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await outboxRow(t);
    expect(row).toMatchObject({
      status: "delivered",
      attemptCount: 1,
    });
    expect(row).not.toHaveProperty("leaseUntil");
    expect(row).not.toHaveProperty("leaseToken");
    expect(row).not.toHaveProperty("lastErrorCode");
  });

  it("releases the lease and schedules a retry after a transient response", async () => {
    const t = makeTest();
    await seedPendingEvent(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(t.action(internalActions.pikaOutbox.deliver, {})).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      retried: 1,
      failed: 0,
    });
    const row = await outboxRow(t);
    expect(row).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastErrorCode: "http_503",
    });
    expect(row).not.toHaveProperty("leaseUntil");
    expect(row).not.toHaveProperty("leaseToken");
    expect(row?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("marks a non-retryable contract response failed", async () => {
    const t = makeTest();
    await seedPendingEvent(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid", { status: 422 })));

    await expect(t.action(internalActions.pikaOutbox.deliver, {})).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      retried: 0,
      failed: 1,
    });
    const row = await outboxRow(t);
    expect(row).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "http_422",
    });
    expect(row).not.toHaveProperty("leaseUntil");
    expect(row).not.toHaveProperty("leaseToken");
  });

  it("continues draining full batches without waiting for the recovery cron", async () => {
    const t = makeTest();
    await seedPendingEvents(t, 5);
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ accepted: true, duplicate: false, projection_applied: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(t.action(internalActions.pikaOutbox.deliver, { limit: 2 })).resolves.toMatchObject({
      claimed: 5,
      delivered: 5,
    });

    const rows = await t.run(async (ctx) => ctx.db.query("pika_outbox").collect());
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "delivered")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not claim or deliver events while the integration is disabled", async () => {
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");
    const t = makeTest();
    await seedPendingEvent(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(t.action(internalActions.pikaOutbox.deliver, {})).resolves.toEqual({
      claimed: 0,
      delivered: 0,
      retried: 0,
      failed: 0,
      disabled: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await outboxRow(t)).toMatchObject({ status: "pending", attemptCount: 0 });
  });
});
