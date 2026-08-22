import { WorkOS } from "@workos-inc/node";
import { v } from "convex/values";
import { brand } from "../config/brand";
import { internal, internalActions } from "./api";
import { workosMagicEmailDeliveryConfiguration } from "./workosMagicEmailConfiguration";
import { internalAction } from "./server";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_IDEMPOTENCY_SAFETY_MS = 10 * 60_000;
const MIN_USEFUL_CHALLENGE_LIFETIME_MS = 2 * 60_000;
const MAX_BATCHES_PER_RUN = 4;

function retryDelayMs(attemptCount: number) {
  return Math.min(2 * 60_000, 15_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 3));
}

function requestStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email);
}

function isDuplicateBrevoResponse(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    (value as { code?: unknown }).code === "duplicate_parameter"
  );
}

export const deliver = internalAction({
  args: {},
  returns: v.object({
    claimed: v.number(),
    delivered: v.number(),
    retried: v.number(),
    failed: v.number(),
    disabled: v.boolean(),
  }),
  handler: async (ctx) => {
    const configuration = workosMagicEmailDeliveryConfiguration();
    if (!configuration) {
      return { claimed: 0, delivered: 0, retried: 0, failed: 0, disabled: true };
    }

    const workos = new WorkOS({
      apiKey: configuration.workosApiKey,
      timeout: 8_000,
      maxRetries: 0,
    });
    const limit = 1;
    let claimedCount = 0;
    let delivered = 0;
    let retried = 0;
    let failed = 0;
    let lastBatchWasFull = false;

    const recordFailure = async (input: {
      row: {
        eventId: string;
        leaseToken: string;
        expiresAt: number;
        attemptCount: number;
      };
      errorCode: string;
      retryable: boolean;
      brevoFirstAttemptAt?: number;
    }) => {
      const now = Date.now();
      const delay = retryDelayMs(input.row.attemptCount);
      const challengeDeadline = input.row.expiresAt - MIN_USEFUL_CHALLENGE_LIFETIME_MS;
      const brevoDeadline = input.brevoFirstAttemptAt
        ? input.brevoFirstAttemptAt + BREVO_IDEMPOTENCY_SAFETY_MS
        : Number.POSITIVE_INFINITY;
      const retryDeadline = Math.min(challengeDeadline, brevoDeadline);
      if (input.retryable && now + delay < retryDeadline) {
        const applied = await ctx.runMutation(internal.workosMagicEmailModel.retry, {
          eventId: input.row.eventId,
          leaseToken: input.row.leaseToken,
          errorCode: input.errorCode,
          nextAttemptAt: now + delay,
          now,
        });
        if (applied) retried += 1;
        else failed += 1;
        return;
      }
      const applied = await ctx.runMutation(internal.workosMagicEmailModel.fail, {
        eventId: input.row.eventId,
        leaseToken: input.row.leaseToken,
        errorCode: input.retryable ? `${input.errorCode}_retry_window_exhausted` : input.errorCode,
        now,
      });
      if (applied) failed += 1;
    };

    for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_RUN; batchIndex += 1) {
      const claimed = await ctx.runMutation(internal.workosMagicEmailModel.claim, {
        now: Date.now(),
        limit,
      });
      claimedCount += claimed.length;
      lastBatchWasFull = claimed.length === limit;

      for (const row of claimed) {
        const now = Date.now();
        if (row.clientId !== configuration.baraClientId) {
          await recordFailure({ row, errorCode: "client_mismatch", retryable: false });
          continue;
        }
        if (row.expiresAt - now <= MIN_USEFUL_CHALLENGE_LIFETIME_MS) {
          await recordFailure({ row, errorCode: "challenge_expired", retryable: false });
          continue;
        }
        if (
          row.brevoFirstAttemptAt &&
          now - row.brevoFirstAttemptAt >= BREVO_IDEMPOTENCY_SAFETY_MS
        ) {
          await recordFailure({
            row,
            errorCode: "brevo_retry_window_exhausted",
            retryable: false,
            brevoFirstAttemptAt: row.brevoFirstAttemptAt,
          });
          continue;
        }

        let magicAuth;
        try {
          magicAuth = await workos.userManagement.getMagicAuth(row.magicAuthId);
        } catch (error) {
          const status = requestStatus(error);
          const retryable =
            status === null ||
            status === 404 ||
            status === 408 ||
            status === 429 ||
            status >= 500;
          await recordFailure({
            row,
            errorCode: status === null ? "workos_network_error" : `workos_http_${status}`,
            retryable,
            brevoFirstAttemptAt: row.brevoFirstAttemptAt,
          });
          continue;
        }

        const magicAuthExpiresAt = Date.parse(magicAuth.expiresAt);
        if (
          magicAuth.id !== row.magicAuthId ||
          !isValidEmail(magicAuth.email) ||
          !/^\d{6}$/.test(magicAuth.code) ||
          !Number.isFinite(magicAuthExpiresAt) ||
          Math.abs(magicAuthExpiresAt - row.expiresAt) > 1_000 ||
          magicAuthExpiresAt - Date.now() <= MIN_USEFUL_CHALLENGE_LIFETIME_MS
        ) {
          await recordFailure({ row, errorCode: "invalid_magic_auth", retryable: false });
          continue;
        }

        const brevoFirstAttemptAt = await ctx.runMutation(
          internal.workosMagicEmailModel.markBrevoAttempt,
          {
            eventId: row.eventId,
            leaseToken: row.leaseToken,
            now: Date.now(),
          },
        );
        if (brevoFirstAttemptAt === null) {
          failed += 1;
          continue;
        }
        const remainingMinutes = Math.floor((magicAuthExpiresAt - Date.now()) / 60_000);
        if (remainingMinutes < 2) {
          await recordFailure({ row, errorCode: "challenge_expired", retryable: false });
          continue;
        }

        let response: Response | null = null;
        try {
          response = await fetch(BREVO_SEND_URL, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "api-key": configuration.brevoApiKey,
            },
            body: JSON.stringify({
              sender: {
                email: configuration.brevoFromEmail,
                name: configuration.brevoFromName,
              },
              to: [{ email: magicAuth.email }],
              templateId: configuration.brevoTemplateId,
              params: { code: magicAuth.code, expires: remainingMinutes, type: "magic_auth" },
              headers: { idempotencyKey: row.brevoIdempotencyKey },
              tags: ["workos-magic-auth", brand.name.toLocaleLowerCase()],
            }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          response = null;
        }

        let duplicate = false;
        if (response && !response.ok) {
          try {
            duplicate = isDuplicateBrevoResponse(
              JSON.parse((await response.text()).slice(0, 10_000)),
            );
          } catch {
            duplicate = false;
          }
        }
        if (response?.ok || duplicate) {
          const applied = await ctx.runMutation(internal.workosMagicEmailModel.complete, {
            eventId: row.eventId,
            leaseToken: row.leaseToken,
            now: Date.now(),
          });
          if (applied) delivered += 1;
          else failed += 1;
          continue;
        }

        const status = response?.status ?? null;
        const retryable = status === null || status === 408 || status === 429 || status >= 500;
        await recordFailure({
          row,
          errorCode: status === null ? "brevo_network_error" : `brevo_http_${status}`,
          retryable,
          brevoFirstAttemptAt,
        });
      }

      if (!lastBatchWasFull) break;
    }

    if (lastBatchWasFull && process.env.VITEST !== "true") {
      await ctx.scheduler.runAfter(0, internalActions.workosMagicEmail.deliver, {});
    }

    return { claimed: claimedCount, delivered, retried, failed, disabled: false };
  },
});
