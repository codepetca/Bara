import { listCurrentMemberships } from "./auth";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type IdentityCtx = MutationCtx | QueryCtx;

async function identityForWorkosSubject(ctx: IdentityCtx, subject: string) {
  return ctx.db
    .query("auth_identities")
    .withIndex("by_provider_and_providerSubject", (q) =>
      q.eq("provider", "workos").eq("providerSubject", subject),
    )
    .unique();
}

export async function appUserForWorkosSubject(ctx: IdentityCtx, subject: string) {
  const identity = await identityForWorkosSubject(ctx, subject);
  if (!identity) return null;
  const appUser = await ctx.db.get(identity.appUserId);
  return appUser?.status === "active" ? appUser : null;
}

function tenantSlug(installationRef: string, tenantRef: string) {
  let hash = 2166136261;
  for (const character of `${installationRef}:${tenantRef}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `pika-${(hash >>> 0).toString(36)}`;
}

async function createTenantOrganization(
  ctx: MutationCtx,
  args: { installationRef: string; tenantRef: string; now: number },
) {
  const slug = tenantSlug(args.installationRef, args.tenantRef);
  const existingSlug = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (existingSlug) throw new Error("Pika tenant organization mapping is ambiguous.");
  return ctx.db.insert("organizations", {
    name: "Pika workspace",
    slug,
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function tenantMapping(
  ctx: IdentityCtx,
  installationRef: string,
  tenantRef: string,
) {
  return ctx.db
    .query("pika_installation_tenants")
    .withIndex("by_installationRef_and_tenantRef", (q) =>
      q.eq("installationRef", installationRef).eq("tenantRef", tenantRef),
    )
    .unique();
}

async function ensureMembership(
  ctx: MutationCtx,
  args: {
    appUser: Doc<"app_users">;
    organizationId: Id<"organizations">;
    requestedRole: "staff" | "student";
    now: number;
  },
) {
  const existing = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", args.appUser._id).eq("organizationId", args.organizationId),
    )
    .unique();
  if (existing) {
    const compatible =
      existing.status === "active" &&
      (args.requestedRole === "student"
        ? existing.role === "student"
        : existing.role === "staff" || existing.role === "admin");
    return compatible ? existing : null;
  }

  const membershipId = await ctx.db.insert("organization_memberships", {
    appUserId: args.appUser._id,
    organizationId: args.organizationId,
    role: args.requestedRole,
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
  });
  if (!args.appUser.defaultOrganizationId) {
    await ctx.db.patch(args.appUser._id, {
      defaultOrganizationId: args.organizationId,
      updatedAt: args.now,
    });
  }
  return ctx.db.get(membershipId);
}

export async function ensurePikaPrincipal(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    tenantRef: string;
    subject: string;
    displayName: string;
    requestedRole: "staff" | "student";
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const mapping = await tenantMapping(ctx, args.installationRef, args.tenantRef);
  if (!mapping) return { ok: false as const, code: "tenant_not_found" as const };
  const organization = await ctx.db.get(mapping.organizationId);
  if (!organization || organization.status !== "active") {
    return { ok: false as const, code: "tenant_not_found" as const };
  }

  const existingIdentity = await identityForWorkosSubject(ctx, args.subject);
  let appUser = existingIdentity ? await ctx.db.get(existingIdentity.appUserId) : null;
  if (existingIdentity && (!appUser || appUser.status !== "active")) {
    return { ok: false as const, code: "identity_invalid" as const };
  }
  if (!existingIdentity) {
    const appUserId = await ctx.db.insert("app_users", {
      displayName: args.displayName.trim(),
      status: "active",
      defaultOrganizationId: organization._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auth_identities", {
      appUserId,
      provider: "workos",
      providerSubject: args.subject,
      tokenIdentifier: `pika:${args.installationRef}:${args.subject}`,
      nameSnapshot: args.displayName.trim(),
      provisionedByInstallationRef: args.installationRef,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    appUser = await ctx.db.get(appUserId);
  }
  if (!appUser || appUser.status !== "active") {
    return { ok: false as const, code: "identity_invalid" as const };
  }

  const membership = await ensureMembership(ctx, {
    appUser,
    organizationId: organization._id,
    requestedRole: args.requestedRole,
    now,
  });
  if (!membership) return { ok: false as const, code: "role_conflict" as const };
  return { ok: true as const, appUser, membership, organization };
}

export async function ensurePikaRosterOwner(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    tenantRef: string;
    subject: string;
    displayName: string;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  let mapping = await tenantMapping(ctx, args.installationRef, args.tenantRef);
  if (!mapping) {
    const existingAppUser = await appUserForWorkosSubject(ctx, args.subject);
    const memberships = existingAppUser
      ? await listCurrentMemberships(ctx, existingAppUser._id)
      : [];
    const staffMembership = memberships.find(
      ({ membership }) => membership.role === "staff" || membership.role === "admin",
    );
    const organizationId =
      staffMembership?.organization._id ??
      (await createTenantOrganization(ctx, {
        installationRef: args.installationRef,
        tenantRef: args.tenantRef,
        now,
      }));
    const mappingId = await ctx.db.insert("pika_installation_tenants", {
      installationRef: args.installationRef,
      tenantRef: args.tenantRef,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });
    mapping = await ctx.db.get(mappingId);
  }
  if (!mapping) return { ok: false as const, code: "tenant_not_found" as const };
  return ensurePikaPrincipal(ctx, {
    installationRef: args.installationRef,
    tenantRef: args.tenantRef,
    subject: args.subject,
    displayName: args.displayName,
    requestedRole: "staff",
    now,
  });
}
