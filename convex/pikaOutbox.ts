import { v } from "convex/values";
import { createV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import { internal, internalActions } from "./api";
import {
  isAllowedPikaDeliveryOrigin,
  isPikaAttendanceIntegrationEnabled,
} from "./pikaConfiguration";
import { internalAction } from "./server";

const EVENT_PATH = "/api/integrations/attendance/v1/events";
const MAX_BATCHES_PER_RUN = 4;
function deliveryConfiguration() {
  if (!isPikaAttendanceIntegrationEnabled()) return null;
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  const secret = process.env.PIKA_EVENT_DELIVERY_SECRET ?? "";
  const rawUrl = process.env.PIKA_EVENT_DELIVERY_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Attendance event delivery is not configured.");
  }
  if (
    !/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef) ||
    secret.length < 32 ||
    !isAllowedPikaDeliveryOrigin(url) ||
    url.username ||
    url.password ||
    url.pathname !== EVENT_PATH ||
    url.search ||
    url.hash
  ) {
    throw new Error("Attendance event delivery is not configured.");
  }
  return { installationRef, secret, url: url.toString() };
}

function retryDelayMs(attemptCount: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 7));
}

export const deliver = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    claimed: v.number(),
    delivered: v.number(),
    retried: v.number(),
    failed: v.number(),
    disabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const configuration = deliveryConfiguration();
    if (!configuration) {
      return { claimed: 0, delivered: 0, retried: 0, failed: 0, disabled: true };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 10), 1), 10);
    let claimedCount = 0;
    let delivered = 0;
    let retried = 0;
    let failed = 0;
    let lastBatchWasFull = false;

    for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_RUN; batchIndex += 1) {
      const claimed = await ctx.runMutation(internal.pikaOutboxModel.claim, {
        now: Date.now(),
        limit,
      });
      claimedCount += claimed.length;
      lastBatchWasFull = claimed.length === limit;

      for (const row of claimed) {
        const now = Date.now();
        const timestamp = String(Math.floor(now / 1000));
        const nonce = `nonce_${crypto.randomUUID().replaceAll("-", "")}`;
        const signature = await createV1RequestSignature({
          secret: configuration.secret,
          method: "POST",
          path: EVENT_PATH,
          timestamp,
          nonce,
          body: row.payloadJson,
        });

        let response: Response | null = null;
        let errorCode = "network_error";
        try {
          response = await fetch(configuration.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Attendance-Installation-Ref": configuration.installationRef,
              "X-Attendance-Timestamp": timestamp,
              "X-Attendance-Nonce": nonce,
              "X-Attendance-Signature": signature,
            },
            body: row.payloadJson,
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          errorCode = `http_${response.status}`;
        } catch {
          response = null;
        }

        let accepted = false;
        if (response?.ok) {
          try {
            const text = (await response.text()).slice(0, 20_000);
            const parsed = JSON.parse(text) as { accepted?: unknown };
            accepted = parsed.accepted === true;
            if (!accepted) errorCode = "invalid_response";
          } catch {
            errorCode = "invalid_response";
          }
        }

        if (accepted) {
          await ctx.runMutation(internal.pikaOutboxModel.complete, {
            eventId: row.eventId,
            leaseToken: row.leaseToken,
            now: Date.now(),
          });
          delivered += 1;
          continue;
        }

        const retryable =
          !response || response.status === 408 || response.status === 429 || response.status >= 500;
        if (retryable) {
          await ctx.runMutation(internal.pikaOutboxModel.retry, {
            eventId: row.eventId,
            leaseToken: row.leaseToken,
            errorCode,
            nextAttemptAt: Date.now() + retryDelayMs(row.attemptCount),
            now: Date.now(),
          });
          retried += 1;
        } else {
          await ctx.runMutation(internal.pikaOutboxModel.fail, {
            eventId: row.eventId,
            leaseToken: row.leaseToken,
            errorCode,
            now: Date.now(),
          });
          failed += 1;
        }
      }

      if (!lastBatchWasFull) break;
    }

    if (lastBatchWasFull && process.env.VITEST !== "true") {
      await ctx.scheduler.runAfter(0, internalActions.pikaOutbox.deliver, { limit });
    }

    return { claimed: claimedCount, delivered, retried, failed, disabled: false };
  },
});
