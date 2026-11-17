import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type Ctx = MutationCtx | QueryCtx;

export function pikaRosterMapping(ctx: Ctx, rosterId: Id<"rosters">) {
  return ctx.db.query("pika_integrated_rosters").withIndex("by_rosterId", q => q.eq("rosterId", rosterId)).unique();
}

export async function matchesPikaTenant(ctx: Ctx, mapping: Doc<"pika_integrated_rosters">, organizationId: Id<"organizations">) {
  const { installationRef, tenantRef } = mapping;
  if (!tenantRef) return false;
  const tenant = await ctx.db.query("pika_installation_tenants").withIndex("by_installationRef_and_tenantRef", q =>
    q.eq("installationRef", installationRef).eq("tenantRef", tenantRef)).unique();
  return tenant?.organizationId === organizationId && (await ctx.db.get(organizationId))?.status === "active";
}

export async function pikaCatalog(ctx: Ctx, mapping: Doc<"pika_integrated_rosters">, roster: Doc<"rosters">) {
  if (!mapping.roomCatalogOrganizationId || roster.pikaDecommissioned ||
    !await matchesPikaTenant(ctx, mapping, roster.organizationId)) return null;
  const catalog = await ctx.db.get(mapping.roomCatalogOrganizationId);
  return catalog?.status === "active" ? catalog._id : null;
}

export async function pikaRosterCanUseRoom(
  ctx: Ctx, room: Doc<"rooms">, mapping: Doc<"pika_integrated_rosters">, roster: Doc<"rosters">,
) {
  if (room.archivedAt !== undefined || roster.pikaDecommissioned) return false;
  if (room.pikaInstallationRef) {
    return room.pikaInstallationRef === mapping.installationRef && room.organizationId === roster.organizationId &&
      (await ctx.db.get(room.organizationId))?.status === "active";
  }
  return room.organizationId === await pikaCatalog(ctx, mapping, roster);
}

export async function sharedPikaWindows(
  ctx: Ctx, room: Doc<"rooms">, windows: Doc<"sessions">[], installationRef?: string,
) {
  if (room.pikaInstallationRef || room.archivedAt !== undefined) return [];
  const eligible = await Promise.all(windows.map(async session => {
    const mapping = await pikaRosterMapping(ctx, session.rosterId);
    if (!mapping || (installationRef && mapping.installationRef !== installationRef)) return null;
    const roster = await ctx.db.get(session.rosterId);
    return roster && await pikaRosterCanUseRoom(ctx, room, mapping, roster) ? session : null;
  }));
  return eligible.filter(session => session !== null);
}
