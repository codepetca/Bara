// @vitest-environment edge-runtime

import { WorkOS } from "@workos-inc/node";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "../config/brand";
import { internal, internalActions } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const baraClientId = "client_test_attendance";
const pikaClientId = "client_test_pika";
const webhookSecret = "whsec_test_secret_at_least_32_characters_long"; // gitleaks:allow
const eventId = "event_test_magic_auth_created";
const magicAuthId = "magic_auth_test_123";
const recipient = "student@school.example";
const code = "123456";

function makeTest() {
  return convexTest(schema, modules);
}

function eventPayload(clientId = baraClientId, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return JSON.stringify({
    id: eventId,
    event: "magic_auth.created",
    created_at: new Date(now).toISOString(),
    context: { client_id: clientId },
    data: {
      object: "magic_auth",
      id: magicAuthId,
      user_id: "user_test_123",
      email: recipient,
      expires_at: new Date(now + 10 * 60_000).toISOString(),
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    },
    ...overrides,
  });
}

async function signatureFor(payload: string) {
  const workos = new WorkOS();
  const timestamp = String(Date.now());
  const signature = await workos.webhooks.computeSignature(timestamp, payload, webhookSecret);
  return `t=${timestamp},v1=${signature}`;
}

async function postEvent(t: ReturnType<typeof makeTest>, payload: string, signature?: string) {
  return t.fetch("/api/webhooks/workos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WorkOS-Signature": signature ?? (await signatureFor(payload)),
    },
    body: payload,
  });
}

async function outboxRows(t: ReturnType<typeof makeTest>) {
  return t.run(async (ctx) => ctx.db.query("workos_magic_email_outbox").collect());
}

async function seedPendingEvent(
  t: ReturnType<typeof makeTest>,
  options: { expiresAt?: number; brevoFirstAttemptAt?: number } = {},
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("workos_magic_email_outbox", {
      eventId,
      magicAuthId,
      clientId: baraClientId,
      expiresAt: options.expiresAt ?? now + 10 * 60_000,
      brevoIdempotencyKey: "123e4567-e89b-42d3-a456-426614174000", // gitleaks:allow
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
      brevoFirstAttemptAt: options.brevoFirstAttemptAt,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function workosMagicAuthResponse(expiresAt: number) {
  return new Response(
    JSON.stringify({
      object: "magic_auth",
      id: magicAuthId,
      user_id: "user_test_123",
      email: recipient,
      expires_at: new Date(expiresAt).toISOString(),
      code,
      created_at: new Date(expiresAt - 60_000).toISOString(),
      updated_at: new Date(expiresAt - 60_000).toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("WorkOS Magic Auth webhook", () => {
  beforeEach(() => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("WORKOS_MAGIC_AUTH_BREVO_DELIVERY", "true");
    vi.stubEnv("WORKOS_MAGIC_AUTH_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("WORKOS_API_KEY", "sk_test_attendance_api_key");
    vi.stubEnv("WORKOS_CLIENT_ID", baraClientId);
    vi.stubEnv("PIKA_WORKOS_CLIENT_ID", pikaClientId);
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test-attendance-key");
    vi.stubEnv("BREVO_TEMPLATE_ID", "2");
    vi.stubEnv("BREVO_FROM_EMAIL", "noreply@notify.codepet.ca");
    vi.stubEnv("BREVO_FROM_NAME", brand.name);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects an invalid signature without persisting the event", async () => {
    const t = makeTest();
    const response = await postEvent(t, eventPayload(), "t=0,v1=invalid");
    expect(response.status).toBe(400);
    await expect(outboxRows(t)).resolves.toHaveLength(0);
  });

  it("persists one metadata-only row for duplicate application events", async () => {
    const t = makeTest();
    const payload = eventPayload();
    const first = await postEvent(t, payload);
    const second = await postEvent(t, payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, outcome: "created" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, outcome: "duplicate" });

    const rows = await outboxRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId, magicAuthId, clientId: baraClientId });
    expect(JSON.stringify(rows[0])).not.toContain(recipient);
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(rows[0]?.brevoIdempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("acknowledges Pika and unknown client events without enqueueing them", async () => {
    const t = makeTest();
    const pikaResponse = await postEvent(t, eventPayload(pikaClientId));
    const unknownResponse = await postEvent(t, eventPayload("client_test_unknown"));
    expect(await pikaResponse.json()).toMatchObject({ outcome: "ignored_pika_application" });
    expect(await unknownResponse.json()).toMatchObject({ outcome: "ignored_unknown_application" });
    await expect(outboxRows(t)).resolves.toHaveLength(0);
  });

  it("verifies but does not persist events while delivery is disabled", async () => {
    vi.stubEnv("WORKOS_MAGIC_AUTH_BREVO_DELIVERY", "false");
    const t = makeTest();
    const response = await postEvent(t, eventPayload());
    expect(await response.json()).toMatchObject({ ok: true, outcome: "delivery_disabled" });
    await expect(outboxRows(t)).resolves.toHaveLength(0);
  });

  it("fails closed when the two application client IDs are not distinct", async () => {
    vi.stubEnv("PIKA_WORKOS_CLIENT_ID", baraClientId);
    const t = makeTest();
    const response = await postEvent(t, eventPayload());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "delivery_not_configured" });
    await expect(outboxRows(t)).resolves.toHaveLength(0);
  });
});

describe("WorkOS Magic Auth Brevo delivery", () => {
  beforeEach(() => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("WORKOS_MAGIC_AUTH_BREVO_DELIVERY", "true");
    vi.stubEnv("WORKOS_API_KEY", "sk_test_attendance_api_key");
    vi.stubEnv("WORKOS_CLIENT_ID", baraClientId);
    vi.stubEnv("PIKA_WORKOS_CLIENT_ID", pikaClientId);
    vi.stubEnv("BREVO_API_KEY", "xkeysib-test-attendance-key");
    vi.stubEnv("BREVO_TEMPLATE_ID", "2");
    vi.stubEnv("BREVO_FROM_EMAIL", "noreply@notify.codepet.ca");
    vi.stubEnv("BREVO_FROM_NAME", brand.name);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retrieves the code from WorkOS and sends one idempotent Brevo request", async () => {
    const t = makeTest();
    const expiresAt = Date.now() + 10 * 60_000;
    await seedPendingEvent(t, { expiresAt });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("api.workos.com")) return workosMagicAuthResponse(expiresAt);
      expect(url).toBe("https://api.brevo.com/v3/smtp/email");
      const headers = new Headers(init?.headers);
      expect(headers.get("api-key")).toBe("xkeysib-test-attendance-key");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        sender: { email: "noreply@notify.codepet.ca", name: brand.name },
        to: [{ email: recipient }],
        templateId: 2,
        params: { code, type: "magic_auth" },
        // Brevo's provider contract requires this exact camelCase field.
        headers: { idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" }, // gitleaks:allow
      });
      const params = body.params as { expires?: unknown };
      expect(params.expires).toEqual(expect.any(Number));
      expect(params.expires).toBeGreaterThanOrEqual(2);
      expect(params.expires).toBeLessThanOrEqual(10);
      return new Response(JSON.stringify({ messageId: "message_test" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(t.action(internalActions.workosMagicEmail.deliver, {})).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      failed: 0,
      disabled: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await outboxRows(t))[0]).toMatchObject({ status: "delivered", attemptCount: 1 });
  });

  it("treats Brevo's duplicate idempotency response as delivered", async () => {
    const t = makeTest();
    const expiresAt = Date.now() + 10 * 60_000;
    await seedPendingEvent(t, { expiresAt, brevoFirstAttemptAt: Date.now() - 30_000 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input.toString().includes("api.workos.com")
          ? workosMagicAuthResponse(expiresAt)
          : new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 }),
      ),
    );

    await expect(t.action(internalActions.workosMagicEmail.deliver, {})).resolves.toMatchObject({
      delivered: 1,
      retried: 0,
      failed: 0,
    });
    expect((await outboxRows(t))[0]).toMatchObject({ status: "delivered" });
  });

  it("retries transient Brevo failures only inside the idempotency window", async () => {
    const t = makeTest();
    const expiresAt = Date.now() + 10 * 60_000;
    await seedPendingEvent(t, { expiresAt });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input.toString().includes("api.workos.com")
          ? workosMagicAuthResponse(expiresAt)
          : new Response("unavailable", { status: 503 }),
      ),
    );

    await expect(t.action(internalActions.workosMagicEmail.deliver, {})).resolves.toMatchObject({
      delivered: 0,
      retried: 1,
      failed: 0,
    });
    const row = (await outboxRows(t))[0];
    expect(row).toMatchObject({ status: "pending", lastErrorCode: "brevo_http_503" });
    expect(row?.brevoFirstAttemptAt).toEqual(expect.any(Number));
    expect(row?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("fails challenges without a useful delivery window before contacting a provider", async () => {
    const t = makeTest();
    await seedPendingEvent(t, { expiresAt: Date.now() + 4 * 60_000 - 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(t.action(internalActions.workosMagicEmail.deliver, {})).resolves.toMatchObject({
      delivered: 0,
      retried: 0,
      failed: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await outboxRows(t))[0]).toMatchObject({
      status: "failed",
      lastErrorCode: "challenge_expired",
    });
  });

  it("renders a conservative remaining lifetime for delayed challenges", async () => {
    const t = makeTest();
    const startedAt = Date.now();
    const expiresAt = startedAt + 4 * 60_000 + 1_000;
    await seedPendingEvent(t, { expiresAt });
    let renderedExpiry: unknown;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input.toString().includes("api.workos.com")) {
          return workosMagicAuthResponse(expiresAt);
        }
        const body = JSON.parse(String(init?.body)) as { params?: { expires?: unknown } };
        renderedExpiry = body.params?.expires;
        dateNow.mockReturnValue(startedAt + 10_000);
        return new Response(JSON.stringify({ messageId: "message_test" }), { status: 201 });
      }),
    );

    await expect(t.action(internalActions.workosMagicEmail.deliver, {})).resolves.toMatchObject({
      delivered: 1,
      failed: 0,
    });
    expect(renderedExpiry).toBe(2);
    expect(Math.floor((expiresAt - Date.now()) / 60_000)).toBeGreaterThanOrEqual(2);
  });

  it("does not let an expired lease initiate Brevo delivery", async () => {
    const t = makeTest();
    const now = Date.now();
    await seedPendingEvent(t, { expiresAt: now + 10 * 60_000 });
    const [firstClaim] = await t.mutation(internal.workosMagicEmailModel.claim, {
      now,
      limit: 1,
    });
    expect(firstClaim).toBeDefined();
    await expect(
      t.mutation(internal.workosMagicEmailModel.markBrevoAttempt, {
        eventId,
        leaseToken: firstClaim!.leaseToken,
        now: now + 60_001,
      }),
    ).resolves.toBeNull();

    const [secondClaim] = await t.mutation(internal.workosMagicEmailModel.claim, {
      now: now + 60_001,
      limit: 1,
    });
    expect(secondClaim?.leaseToken).not.toBe(firstClaim?.leaseToken);
    await expect(
      t.mutation(internal.workosMagicEmailModel.markBrevoAttempt, {
        eventId,
        leaseToken: firstClaim!.leaseToken,
        now: now + 60_002,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(internal.workosMagicEmailModel.markBrevoAttempt, {
        eventId,
        leaseToken: secondClaim!.leaseToken,
        now: now + 60_002,
      }),
    ).resolves.toBe(now + 60_002);
  });

  it("removes old completed and expired pending metadata but keeps active work", async () => {
    const t = makeTest();
    const old = Date.now() - 31 * 24 * 60 * 60_000;
    await t.run(async (ctx) => {
      for (const [suffix, status, updatedAt, expiresAt] of [
        ["delivered", "delivered", old, old],
        ["failed", "failed", old, old],
        ["expired_pending", "pending", old, old],
        ["recent_pending", "pending", Date.now(), Date.now() + 10 * 60_000],
      ] as const) {
        await ctx.db.insert("workos_magic_email_outbox", {
          eventId: `${eventId}_${suffix}`,
          magicAuthId: `${magicAuthId}_${suffix}`,
          clientId: baraClientId,
          expiresAt,
          brevoIdempotencyKey: `123e4567-e89b-42d3-a456-42661417400${suffix.length}`,
          status,
          attemptCount: 1,
          nextAttemptAt: old,
          createdAt: old,
          updatedAt,
        });
      }
    });

    await expect(
      t.mutation(internal.workosMagicEmailModel.cleanup, {
        now: Date.now(),
        batchSize: 10,
      }),
    ).resolves.toEqual({ deleted: 3, continued: false });
    const rows = await outboxRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: `${eventId}_recent_pending`, status: "pending" });
  });
});
