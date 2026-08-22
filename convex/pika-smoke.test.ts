// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createV1RequestSignature,
  verifyV1RequestSignature,
} from "../lib/attendance-contract/v1/signing";
import { internal } from "./api";
import { callPikaSmokeIngress } from "./pikaSmoke";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const installationRef = "pika_smoke_installation";
const integrationSecret = "request-direction-smoke-secret-at-least-32-characters";
const eventSecret = "callback-direction-smoke-secret-at-least-32-characters";
const smokePath = "/api/integrations/pika/v1/smoke";
const callbackPath = "/api/integrations/attendance/v1/smoke/events";
const payload = {
  schema_version: 1 as const,
  kind: "attendance.auth.smoke.request" as const,
  installation_ref: installationRef,
  scope_ref: `scope_${"a".repeat(64)}`,
  challenge: `smoke_${"b".repeat(32)}`,
  rollout_mode: "pre-enable" as const,
};

function makeTest() {
  return convexTest(schema, modules);
}

async function signedSmokeRequest(
  t: ReturnType<typeof makeTest>,
  nonce: string,
  secret = integrationSecret,
  rolloutMode: string | null = "pre-enable",
) {
  const body = JSON.stringify(rolloutMode === null
    ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "rollout_mode"))
    : { ...payload, rollout_mode: rolloutMode });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret,
    method: "POST",
    path: smokePath,
    timestamp,
    nonce,
    body,
  });
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Attendance-Installation-Ref": installationRef,
    "X-Attendance-Timestamp": timestamp,
    "X-Attendance-Nonce": nonce,
    "X-Attendance-Signature": signature,
  });
  return t.fetch(smokePath, {
    method: "POST",
    headers,
    body,
  });
}

describe("deployed provider authentication smoke endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");
    vi.stubEnv("PIKA_INTEGRATION_REF", installationRef);
    vi.stubEnv("PIKA_INTEGRATION_SECRET", integrationSecret);
    vi.stubEnv(
      "PIKA_EVENT_DELIVERY_URL",
      "https://pika.codepet.ca/api/integrations/attendance/v1/events",
    );
    vi.stubEnv("PIKA_EVENT_DELIVERY_SECRET", eventSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("proves both signatures while disabled and mutates only bounded smoke nonce state", async () => {
    const t = makeTest();
    const callback = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url.toString()).toBe(`https://pika.codepet.ca${callbackPath}`);
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      expect(JSON.parse(body)).toEqual({ ...payload, kind: "attendance.auth.smoke.callback" });
      await expect(verifyV1RequestSignature({
        secret: eventSecret,
        method: "POST",
        path: callbackPath,
        timestamp: headers.get("X-Attendance-Timestamp") ?? "",
        nonce: headers.get("X-Attendance-Nonce") ?? "",
        body,
      }, headers.get("X-Attendance-Signature"))).resolves.toBe(true);
      return new Response(JSON.stringify({ ok: true, authenticated: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", callback);

    const response = await signedSmokeRequest(
      t,
      "nonce_0123456789abcdef0123456789abcdef",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      checks: { pika_to_bara: true, bara_to_pika: true },
    });
    expect(callback).toHaveBeenCalledTimes(1);
    const counts = await t.run(async (ctx) => ({
      smokeNonces: (await ctx.db.query("pika_smoke_nonces").collect()).length,
      occurrences: (await ctx.db.query("attendance_occurrences").collect()).length,
      records: (await ctx.db.query("attendance_records").collect()).length,
      events: (await ctx.db.query("attendance_events").collect()).length,
      outbox: (await ctx.db.query("pika_outbox").collect()).length,
    }));
    expect(counts).toEqual({
      smokeNonces: 1,
      occurrences: 0,
      records: 0,
      events: 0,
      outbox: 0,
    });
  });

  it("rejects a Pika secret mismatch before callback and rejects nonce replay", async () => {
    const t = makeTest();
    const callback = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, authenticated: true }), { status: 200 }));
    vi.stubGlobal("fetch", callback);
    const nonce = "nonce_0123456789abcdef0123456789abcdef";

    const mismatch = await signedSmokeRequest(
      t,
      nonce,
      "wrong-secret-that-is-at-least-32-characters",
    );
    expect(mismatch.status).toBe(401);
    expect(callback).not.toHaveBeenCalled();

    expect((await signedSmokeRequest(t, nonce)).status).toBe(200);
    const replay = await signedSmokeRequest(t, nonce);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({ ok: false, error: "replayed_request" });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("requires the authenticated rollout mode to match Bara before consuming a nonce", async () => {
    const t = makeTest();
    const callback = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, authenticated: true }), { status: 200 }));
    vi.stubGlobal("fetch", callback);
    const nonce = "nonce_mode_mismatch_0123456789abcdef";

    const missing = await signedSmokeRequest(t, nonce, integrationSecret, null);
    expect(missing.status).toBe(422);

    const invalid = await signedSmokeRequest(t, nonce, integrationSecret, "all");
    expect(invalid.status).toBe(422);

    const mismatch = await signedSmokeRequest(t, nonce, integrationSecret, "enabled");
    expect(mismatch.status).toBe(503);
    await expect(mismatch.json()).resolves.toEqual({
      ok: false,
      error: "rollout_mode_mismatch",
    });
    expect(callback).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) =>
      (await ctx.db.query("pika_smoke_nonces").collect()).length)).toBe(0);

    vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true");
    expect((await signedSmokeRequest(t, nonce, integrationSecret, "enabled")).status).toBe(200);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("rejects callback configuration drift before consuming nonce state", async () => {
    const t = makeTest();
    vi.stubEnv(
      "PIKA_EVENT_DELIVERY_URL",
      "https://relay.example/api/integrations/attendance/v1/events",
    );
    const callback = vi.fn();
    vi.stubGlobal("fetch", callback);

    const response = await signedSmokeRequest(
      t,
      "nonce_bad_callback_0123456789abcdef",
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "callback_not_configured",
    });
    expect(callback).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) =>
      (await ctx.db.query("pika_smoke_nonces").collect()).length)).toBe(0);
  });

  it("refuses to sign a callback for an unreviewed HTTPS origin", async () => {
    vi.stubEnv(
      "PIKA_EVENT_DELIVERY_URL",
      "https://relay.example/api/integrations/attendance/v1/events",
    );
    const callback = vi.fn();

    await expect(callPikaSmokeIngress({
      payload: { ...payload, kind: "attendance.auth.smoke.callback" },
      fetcher: callback,
    })).rejects.toThrow("Attendance smoke callback is not configured.");
    expect(callback).not.toHaveBeenCalled();
  });

  it("rate limits distinct valid nonces within the fixed window", async () => {
    const t = makeTest();
    const now = Date.now();
    for (let index = 0; index < 5; index += 1) {
      await expect(t.mutation(internal.pikaSmoke.consumeNonce, {
        installationRef,
        nonce: `nonce_rate_limit_${index}_abcdefghijklmnop`,
        requestTimestamp: Math.floor(now / 1000),
        now,
      })).resolves.toBe("accepted");
    }
    await expect(t.mutation(internal.pikaSmoke.consumeNonce, {
      installationRef,
      nonce: "nonce_rate_limit_5_abcdefghijklmnop",
      requestTimestamp: Math.floor(now / 1000),
      now,
    })).resolves.toBe("rate_limited");
  });
});
