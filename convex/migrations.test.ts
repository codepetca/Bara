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

describe("roster ownership migration", () => {
  it("backfills a legacy roster and exposes a clean completion check", async () => {
    const t = convexTest(schema, modules);
    const { rosterId, ownerId } = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("app_users", {
        displayName: "Legacy owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Legacy organization",
        slug: "legacy-organization",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const rosterId = await ctx.db.insert("rosters", {
        organizationId,
        createdByAppUserId: ownerId,
        name: "Legacy roster",
        createdAt: now,
        updatedAt: now,
      });
      return { rosterId, ownerId };
    });

    await expect(t.query(internal.migrations.rosterOwnerBackfillStatus, {})).resolves.toEqual({
      complete: false,
      ownerlessRosterId: rosterId,
    });

    await t.mutation(internal.migrations.backfillRosterOwnerAppUserId, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    await t.run(async (ctx) => {
      expect((await ctx.db.get(rosterId))?.ownerAppUserId).toBe(ownerId);
    });
    await expect(t.query(internal.migrations.rosterOwnerBackfillStatus, {})).resolves.toEqual({
      complete: true,
    });
  });
});
