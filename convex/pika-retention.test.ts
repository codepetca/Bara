// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const day = 24 * 60 * 60 * 1_000;

describe("Pika replay and idempotency retention", () => {
  it("deletes only expired rows using bounded indexed batches", async () => {
    const t = convexTest(schema, modules);
    const now = Date.parse("2026-08-17T12:00:00Z");
    await t.run(async (ctx) => {
      for (const [suffix, createdAt] of [
        ["expired", now - 2 * day],
        ["current", now - day / 2],
      ] as const) {
        await ctx.db.insert("pika_request_nonces", {
          installationRef: "installation_one",
          nonce: `nonce_${suffix}_1234567890`,
          requestTimestamp: Math.floor(createdAt / 1_000),
          createdAt,
        });
      }
      for (const [suffix, createdAt] of [
        ["expired", now - 31 * day],
        ["current", now - 29 * day],
      ] as const) {
        await ctx.db.insert("pika_idempotency", {
          installationRef: "installation_one",
          idempotencyKey: `key:${suffix}`,
          correlationRef: `correlation_${suffix}`,
          messageType: "student_check_in",
          bodyDigest: `digest_${suffix}`,
          resourceRef: "occurrence_one",
          sourceRevision: 1,
          createdCount: 0,
          updatedCount: 0,
          deactivatedCount: 0,
          createdAt,
        });
      }
    });

    await expect(t.mutation(internal.pikaRetention.cleanup, { now })).resolves.toEqual({
      deletedNonces: 1,
      deletedIdempotency: 1,
      continued: false,
    });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("pika_request_nonces").collect()).map((row) => row.nonce))
        .toEqual(["nonce_current_1234567890"]);
      expect((await ctx.db.query("pika_idempotency").collect()).map((row) => row.idempotencyKey))
        .toEqual(["key:current"]);
    });
  });
});
