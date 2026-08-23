import { WorkOS } from "@workos-inc/node";
import { internal, internalActions } from "./api";
import {
  workosMagicEmailDeliveryConfiguration,
  workosWebhookSecret,
} from "./workosMagicEmailConfiguration";
import { httpAction } from "./server";

const MAX_WEBHOOK_BYTES = 1_000_000;
// Signature verification uses only the webhook secret. Supplying a non-secret
// public client ID keeps unrelated HTTP routes import-safe when no API key is
// present, such as during isolated Convex tests.
const webhookWorkos = new WorkOS({ clientId: "client_webhook_signature_verification" });

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const receive = httpAction(async (ctx, request) => {
  const signature = request.headers.get("workos-signature");
  if (!signature) return jsonResponse(400, { ok: false, error: "invalid_signature" });

  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BYTES) {
    return jsonResponse(413, { ok: false, error: "payload_too_large" });
  }

  let secret;
  try {
    secret = workosWebhookSecret();
  } catch {
    return jsonResponse(503, { ok: false, error: "webhook_not_configured" });
  }

  let event;
  try {
    event = await webhookWorkos.webhooks.constructEvent({
      payload,
      sigHeader: signature,
      secret,
    });
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_signature" });
  }

  if (event.event !== "magic_auth.created") {
    return jsonResponse(200, { ok: true, outcome: "ignored_event_type" });
  }

  let configuration;
  try {
    configuration = workosMagicEmailDeliveryConfiguration();
  } catch {
    return jsonResponse(503, { ok: false, error: "delivery_not_configured" });
  }
  if (!configuration) {
    return jsonResponse(200, { ok: true, outcome: "delivery_disabled" });
  }

  const clientId = event.context?.client_id;
  if (clientId === configuration.pikaClientId) {
    return jsonResponse(200, { ok: true, outcome: "ignored_pika_application" });
  }
  if (clientId !== configuration.baraClientId) {
    return jsonResponse(200, { ok: true, outcome: "ignored_unknown_application" });
  }

  const expiresAt = Date.parse(event.data.expiresAt);
  if (
    !event.id ||
    event.id.length > 256 ||
    !event.data.id ||
    event.data.id.length > 256 ||
    !Number.isFinite(expiresAt)
  ) {
    return jsonResponse(422, { ok: false, error: "invalid_event" });
  }

  const result = await ctx.runMutation(internal.workosMagicEmailModel.enqueue, {
    eventId: event.id,
    magicAuthId: event.data.id,
    clientId,
    expiresAt,
    brevoIdempotencyKey: crypto.randomUUID(),
    now: Date.now(),
  });
  if (result.outcome === "conflict") {
    return jsonResponse(409, { ok: false, error: "event_conflict" });
  }
  if (result.outcome === "created" && process.env.VITEST !== "true") {
    await ctx.scheduler.runAfter(0, internalActions.workosMagicEmail.deliver, {});
  }
  return jsonResponse(200, {
    ok: true,
    outcome: result.outcome,
    deliveryStatus: result.status,
  });
});
