import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./model";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillRosterOwnerAppUserId = migrations.define({
  table: "rosters",
  migrateOne: (_ctx, roster) => {
    if (roster.ownerAppUserId !== undefined) return;
    return { ownerAppUserId: roster.createdByAppUserId };
  },
});

export const runRosterOwnerBackfill = migrations.runner(
  internal.migrations.backfillRosterOwnerAppUserId,
);
