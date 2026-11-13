import { ensurePikaPrincipal } from "./pikaIdentity";
import type { MutationCtx } from "./server";

export async function ensurePikaStaffAccess(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    rosterRef: string;
    principalRef: string;
    displayName: string;
    now: number;
  },
) {
  const rosterMapping = await ctx.db
    .query("pika_integrated_rosters")
    .withIndex("by_installationRef_and_rosterRef", (q) =>
      q.eq("installationRef", args.installationRef).eq("rosterRef", args.rosterRef),
    )
    .unique();
  if (!rosterMapping?.tenantRef) {
    return { ok: false as const, code: "integration_state_invalid" as const };
  }
  const roster = await ctx.db.get(rosterMapping.rosterId);
  if (!roster) return { ok: false as const, code: "integration_state_invalid" as const };

  const principal = await ensurePikaPrincipal(ctx, {
    installationRef: args.installationRef,
    tenantRef: rosterMapping.tenantRef,
    principalRef: args.principalRef,
    displayName: args.displayName,
    requestedRole: "staff",
    now: args.now,
  });
  if (!principal.ok || principal.organization._id !== roster.organizationId) {
    return { ok: false as const, code: "actor_not_authorized" as const };
  }

  let access = await ctx.db
    .query("roster_access")
    .withIndex("by_rosterId_membershipId", (q) =>
      q.eq("rosterId", roster._id).eq("membershipId", principal.membership._id),
    )
    .unique();
  if (!access) {
    const accessId = await ctx.db.insert("roster_access", {
      rosterId: roster._id,
      membershipId: principal.membership._id,
      accessRole: principal.membership.role === "admin" ? "admin" : "staff",
      createdAt: args.now,
      updatedAt: args.now,
    });
    access = await ctx.db.get(accessId);
  }
  return access
    ? { ok: true as const, appUser: principal.appUser, roster, access }
    : { ok: false as const, code: "integration_state_invalid" as const };
}
