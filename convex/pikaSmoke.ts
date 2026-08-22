import { v } from "convex/values";
import { createV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import { internalMutation } from "./server";
import { isAllowedPikaDeliveryOrigin } from "./pikaConfiguration";

const EVENT_PATH = "/api/integrations/attendance/v1/events";
export const PIKA_SMOKE_CALLBACK_PATH = "/api/integrations/attendance/v1/smoke/events";
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

const consumeResultValidator = v.union(
  v.literal("accepted"),
  v.literal("replayed"),
  v.literal("rate_limited"),
);

export const consumeNonce = internalMutation({
  args: {
    installationRef: v.string(),
    nonce: v.string(),
    requestTimestamp: v.number(),
    now: v.number(),
  },
  returns: consumeResultValidator,
  handler: async (ctx, args) => {
    const configuredInstallationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
    if (
      args.installationRef !== configuredInstallationRef ||
      !/^[A-Za-z0-9._~-]{16,128}$/.test(args.nonce) ||
      !Number.isSafeInteger(args.requestTimestamp) ||
      Math.abs(Math.floor(args.now / 1000) - args.requestTimestamp) > 300
    ) return "replayed";

    const existing = await ctx.db
      .query("pika_smoke_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", args.installationRef).eq("nonce", args.nonce),
      )
      .unique();
    if (existing) return "replayed";
    const recent = await ctx.db
      .query("pika_smoke_nonces")
      .withIndex("by_installationRef_and_createdAt", (q) =>
        q.eq("installationRef", args.installationRef).gte("createdAt", args.now - WINDOW_MS),
      )
      .take(MAX_ATTEMPTS_PER_WINDOW);
    if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) return "rate_limited";
    await ctx.db.insert("pika_smoke_nonces", {
      installationRef: args.installationRef,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: args.now,
    });
    return "accepted";
  },
});

function callbackConfiguration() {
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  const secret = process.env.PIKA_EVENT_DELIVERY_SECRET ?? "";
  const inboundSecret = process.env.PIKA_INTEGRATION_SECRET ?? "";
  let url: URL;
  try {
    url = new URL(process.env.PIKA_EVENT_DELIVERY_URL?.trim() ?? "");
  } catch {
    throw new Error("Attendance smoke callback is not configured.");
  }
  if (
    !/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef) ||
    secret.length < 32 ||
    inboundSecret.length < 32 ||
    secret === inboundSecret ||
    !isAllowedPikaDeliveryOrigin(url) ||
    url.username ||
    url.password ||
    url.pathname !== EVENT_PATH ||
    url.search ||
    url.hash
  ) throw new Error("Attendance smoke callback is not configured.");
  url.pathname = PIKA_SMOKE_CALLBACK_PATH;
  return { installationRef, secret, url: url.toString() };
}

export async function callPikaSmokeIngress(input: {
  payload: {
    schema_version: 1;
    kind: "attendance.auth.smoke.callback";
    installation_ref: string;
    scope_ref: string;
    challenge: string;
    rollout_mode: "pre-enable" | "enabled";
  };
  fetcher?: typeof fetch;
  now?: number;
  nonce?: string;
}) {
  const config = callbackConfiguration();
  if (input.payload.installation_ref !== config.installationRef) return false;
  const body = JSON.stringify(input.payload);
  const now = input.now ?? Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const nonce = input.nonce ?? `nonce_${crypto.randomUUID().replaceAll("-", "")}`;
  const signature = await createV1RequestSignature({
    secret: config.secret,
    method: "POST",
    path: PIKA_SMOKE_CALLBACK_PATH,
    timestamp,
    nonce,
    body,
  });
  try {
    const response = await (input.fetcher ?? fetch)(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Attendance-Installation-Ref": config.installationRef,
        "X-Attendance-Timestamp": timestamp,
        "X-Attendance-Nonce": nonce,
        "X-Attendance-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const text = (await response.text()).slice(0, 2_048);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return Object.keys(parsed).length === 2 && parsed.ok === true && parsed.authenticated === true;
  } catch {
    return false;
  }
}
