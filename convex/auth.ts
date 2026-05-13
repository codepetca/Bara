import type { UserIdentity } from "convex/server";
import { getAuthProvider } from "./authProviders";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type AuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

type AuthIdentityDoc = Doc<"auth_identities">;
type AppUserDoc = Doc<"app_users">;
type MembershipDoc = Doc<"organization_memberships">;
type OrganizationDoc = Doc<"organizations">;

function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase();
}

function getDisplayName(identity: UserIdentity) {
  const name = identity.name?.trim();
  if (name && name.length > 0) {
    return name;
  }

  if (identity.email) {
    return normalizeEmail(identity.email);
  }

  return identity.subject;
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildOrganizationName(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? `${trimmed}'s workspace` : "Tapcheck workspace";
}

function buildOrganizationSlug(displayName: string, appUserId: Id<"app_users">) {
  const base = slugify(displayName) || "tapcheck-workspace";
  return `${base}-${String(appUserId).slice(-8).toLocaleLowerCase()}`;
}

function toCurrentAppUserResult(
  appUser: AppUserDoc,
  authIdentity: AuthIdentityDoc | null,
  organization: OrganizationDoc | null,
  membership: MembershipDoc | null,
) {
  return {
    _id: appUser._id,
    displayName: appUser.displayName,
    status: appUser.status,
    createdAt: appUser.createdAt,
    identity: authIdentity
      ? {
          provider: authIdentity.provider,
          email: authIdentity.emailSnapshot,
          emailVerified: authIdentity.emailVerifiedSnapshot,
          name: authIdentity.nameSnapshot,
        }
      : undefined,
    defaultOrganization:
      organization && membership
        ? {
            _id: organization._id,
            name: organization.name,
            role: membership.role,
          }
        : undefined,
  };
}

async function getAuthIdentityByIssuerSubject(
  ctx: AuthCtx,
  issuer: string | undefined,
  providerSubject: string,
) {
  if (!issuer) {
    return null;
  }

  return await ctx.db
    .query("auth_identities")
    .withIndex("by_issuer_and_providerSubject", (q) =>
      q.eq("issuer", issuer).eq("providerSubject", providerSubject),
    )
    .unique();
}

async function getAuthIdentityByProviderSubject(
  ctx: AuthCtx,
  provider: string,
  providerSubject: string,
  issuer: string | undefined,
) {
  const candidates = await ctx.db
    .query("auth_identities")
    .withIndex("by_provider_and_providerSubject", (q) =>
      q.eq("provider", provider).eq("providerSubject", providerSubject),
    )
    .take(5);

  return (
    candidates.find((candidate) => candidate.issuer === issuer) ??
    candidates.find((candidate) => !candidate.issuer) ??
    null
  );
}

async function getAuthIdentityByVerifiedEmail(ctx: AuthCtx, email: string) {
  const candidates = await ctx.db
    .query("auth_identities")
    .withIndex("by_emailSnapshot", (q) => q.eq("emailSnapshot", email))
    .take(20);

  const verifiedCandidates = candidates.filter(
    (candidate) => candidate.emailVerifiedSnapshot === true,
  );
  const appUserIds = Array.from(new Set(verifiedCandidates.map((candidate) => candidate.appUserId)));

  if (appUserIds.length !== 1) {
    return null;
  }

  return verifiedCandidates.find((candidate) => candidate.appUserId === appUserIds[0]) ?? null;
}

async function getActiveMembership(
  ctx: AuthCtx,
  appUserId: Id<"app_users">,
  organizationId: Id<"organizations">,
) {
  const membership = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", appUserId).eq("organizationId", organizationId),
    )
    .unique();

  if (!membership || membership.status !== "active") {
    return null;
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status !== "active") {
    return null;
  }

  return {
    membership,
    organization,
  };
}

export async function listCurrentMemberships(ctx: AuthCtx, appUserId: Id<"app_users">) {
  const memberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_status", (q) => q.eq("appUserId", appUserId).eq("status", "active"))
    .collect();

  const resolved = await Promise.all(
    memberships.map(async (membership) => {
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization || organization.status !== "active") {
        return null;
      }

      return {
        membership,
        organization,
      };
    }),
  );

  return resolved.filter(
    (entry): entry is { membership: MembershipDoc; organization: OrganizationDoc } => entry !== null,
  );
}

async function getDefaultOrganizationMembership(ctx: AuthCtx, appUser: AppUserDoc) {
  if (appUser.defaultOrganizationId) {
    const existing = await getActiveMembership(ctx, appUser._id, appUser.defaultOrganizationId);
    if (existing) {
      return existing;
    }
  }

  const memberships = await listCurrentMemberships(ctx, appUser._id);
  return memberships[0] ?? null;
}

async function ensureDefaultOrganizationMembership(ctx: MutationCtx, appUser: AppUserDoc) {
  const existing = await getDefaultOrganizationMembership(ctx, appUser);
  if (existing) {
    if (appUser.defaultOrganizationId !== existing.organization._id) {
      await ctx.db.patch(appUser._id, {
        defaultOrganizationId: existing.organization._id,
        updatedAt: Date.now(),
      });
    }

    return existing;
  }

  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {
    name: buildOrganizationName(appUser.displayName),
    slug: buildOrganizationSlug(appUser.displayName, appUser._id),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const membershipId = await ctx.db.insert("organization_memberships", {
    appUserId: appUser._id,
    organizationId,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(appUser._id, {
    defaultOrganizationId: organizationId,
    updatedAt: now,
  });

  const [organization, membership] = await Promise.all([
    ctx.db.get(organizationId),
    ctx.db.get(membershipId),
  ]);

  if (!organization || !membership) {
    throw new Error("Default organization could not be created.");
  }

  return {
    organization,
    membership,
  };
}

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated.");
  }

  return identity;
}

export async function getCurrentAppUserWithIdentity(ctx: AuthCtx) {
  const identity = await requireIdentity(ctx);

  const authIdentity = await ctx.db
    .query("auth_identities")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  const appUser = authIdentity ? await ctx.db.get(authIdentity.appUserId) : null;
  const defaultMembership = appUser ? await getDefaultOrganizationMembership(ctx, appUser) : null;

  return {
    identity,
    authIdentity,
    appUser,
    defaultOrganization: defaultMembership?.organization ?? null,
    defaultMembership: defaultMembership?.membership ?? null,
  };
}

export async function requireCurrentAppUser(ctx: AuthCtx) {
  const result = await getCurrentAppUserWithIdentity(ctx);
  if (!result.appUser || !result.authIdentity) {
    throw new Error("User account has not been initialized.");
  }

  if (result.appUser.status !== "active") {
    throw new Error("User account is not active.");
  }

  return {
    identity: result.identity,
    authIdentity: result.authIdentity,
    appUser: result.appUser,
    defaultOrganization: result.defaultOrganization,
    defaultMembership: result.defaultMembership,
  };
}

export async function ensureCurrentAppUser(ctx: MutationCtx) {
  const identity = await requireIdentity(ctx);
  const normalizedEmail = identity.email ? normalizeEmail(identity.email) : undefined;
  const displayName = getDisplayName(identity);
  const provider = getAuthProvider(identity);
  const issuer = identity.issuer?.trim() ? identity.issuer : undefined;
  const now = Date.now();

  const existingByTokenIdentifier = await ctx.db
    .query("auth_identities")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  const existingIdentity =
    existingByTokenIdentifier ??
    (await getAuthIdentityByIssuerSubject(ctx, issuer, identity.subject)) ??
    (await getAuthIdentityByProviderSubject(ctx, provider, identity.subject, issuer));

  if (existingIdentity) {
    const appUser = await ctx.db.get(existingIdentity.appUserId);
    if (!appUser) {
      throw new Error("Linked app user was not found.");
    }

    const identityPatch: Partial<
      Pick<
        AuthIdentityDoc,
        | "provider"
        | "tokenIdentifier"
        | "issuer"
        | "emailSnapshot"
        | "emailVerifiedSnapshot"
        | "nameSnapshot"
        | "linkMethod"
        | "lastSeenAt"
        | "updatedAt"
      >
    > = {
      lastSeenAt: now,
    };

    if (existingIdentity.provider !== provider) {
      identityPatch.provider = provider;
    }
    if (existingIdentity.tokenIdentifier !== identity.tokenIdentifier) {
      identityPatch.tokenIdentifier = identity.tokenIdentifier;
    }
    if (issuer && existingIdentity.issuer !== issuer) {
      identityPatch.issuer = issuer;
    }
    if (existingIdentity.emailSnapshot !== normalizedEmail) {
      identityPatch.emailSnapshot = normalizedEmail;
    }
    if (existingIdentity.emailVerifiedSnapshot !== identity.emailVerified) {
      identityPatch.emailVerifiedSnapshot = identity.emailVerified;
    }
    if (existingIdentity.nameSnapshot !== identity.name) {
      identityPatch.nameSnapshot = identity.name;
    }
    if (
      existingIdentity.tokenIdentifier !== identity.tokenIdentifier ||
      existingIdentity.provider !== provider ||
      (issuer && existingIdentity.issuer !== issuer) ||
      existingIdentity.emailSnapshot !== normalizedEmail ||
      existingIdentity.emailVerifiedSnapshot !== identity.emailVerified ||
      existingIdentity.nameSnapshot !== identity.name ||
      existingIdentity.lastSeenAt !== now
    ) {
      identityPatch.updatedAt = now;
    }

    await ctx.db.patch(existingIdentity._id, identityPatch);

    if (appUser.displayName !== displayName) {
      await ctx.db.patch(appUser._id, {
        displayName,
        updatedAt: now,
      });
    }

    const refreshedAppUser = (await ctx.db.get(appUser._id)) ?? appUser;
    const refreshedIdentity = (await ctx.db.get(existingIdentity._id)) ?? existingIdentity;
    const defaultMembership = await ensureDefaultOrganizationMembership(ctx, refreshedAppUser);

    return toCurrentAppUserResult(
      refreshedAppUser,
      refreshedIdentity,
      defaultMembership.organization,
      defaultMembership.membership,
    );
  }

  const verifiedEmailIdentity =
    normalizedEmail && identity.emailVerified === true
      ? await getAuthIdentityByVerifiedEmail(ctx, normalizedEmail)
      : null;

  if (verifiedEmailIdentity) {
    const appUser = await ctx.db.get(verifiedEmailIdentity.appUserId);
    if (!appUser) {
      throw new Error("Linked app user was not found.");
    }

    if (appUser.status !== "active") {
      throw new Error("User account is not active.");
    }

    const authIdentityId = await ctx.db.insert("auth_identities", {
      appUserId: appUser._id,
      provider,
      providerSubject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier,
      ...(issuer ? { issuer } : {}),
      emailSnapshot: normalizedEmail,
      emailVerifiedSnapshot: identity.emailVerified,
      nameSnapshot: identity.name,
      linkMethod: "verified_email",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    if (appUser.displayName !== displayName) {
      await ctx.db.patch(appUser._id, {
        displayName,
        updatedAt: now,
      });
    }

    const refreshedAppUser = (await ctx.db.get(appUser._id)) ?? appUser;
    const authIdentity = await ctx.db.get(authIdentityId);
    if (!authIdentity) {
      throw new Error("User account could not be linked.");
    }

    const defaultMembership = await ensureDefaultOrganizationMembership(ctx, refreshedAppUser);

    return toCurrentAppUserResult(
      refreshedAppUser,
      authIdentity,
      defaultMembership.organization,
      defaultMembership.membership,
    );
  }

  const appUserId = await ctx.db.insert("app_users", {
    displayName,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const authIdentityId = await ctx.db.insert("auth_identities", {
    appUserId,
    provider,
    providerSubject: identity.subject,
    tokenIdentifier: identity.tokenIdentifier,
    ...(issuer ? { issuer } : {}),
    emailSnapshot: normalizedEmail,
    emailVerifiedSnapshot: identity.emailVerified,
    nameSnapshot: identity.name,
    linkMethod: "bootstrap",
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const [appUser, authIdentity] = await Promise.all([
    ctx.db.get(appUserId),
    ctx.db.get(authIdentityId),
  ]);

  if (!appUser || !authIdentity) {
    throw new Error("User account could not be created.");
  }

  const defaultMembership = await ensureDefaultOrganizationMembership(ctx, appUser);

  return toCurrentAppUserResult(
    appUser,
    authIdentity,
    defaultMembership.organization,
    defaultMembership.membership,
  );
}

export async function requireCurrentOrganizationMembership(
  ctx: AuthCtx,
  organizationId?: Id<"organizations">,
) {
  const { appUser } = await requireCurrentAppUser(ctx);

  const resolved =
    organizationId
      ? await getActiveMembership(ctx, appUser._id, organizationId)
      : await getDefaultOrganizationMembership(ctx, appUser);

  if (!resolved) {
    throw new Error("No active organization membership was found.");
  }

  return {
    appUser,
    membership: resolved.membership,
    organization: resolved.organization,
  };
}

export async function requireAccessibleRoster(ctx: AuthCtx, rosterId: Id<"rosters">) {
  const roster = await ctx.db.get(rosterId);
  if (!roster) {
    throw new Error("Roster not found.");
  }

  const { appUser, membership, organization } = await requireCurrentOrganizationMembership(
    ctx,
    roster.organizationId,
  );

  const rosterAccess = await ctx.db
    .query("roster_access")
    .withIndex("by_rosterId_membershipId", (q) =>
      q.eq("rosterId", rosterId).eq("membershipId", membership._id),
    )
    .unique();

  if (!rosterAccess) {
    throw new Error("Unauthorized.");
  }

  return {
    roster,
    rosterAccess,
    appUser,
    membership,
    organization,
  };
}

export function getCurrentAppUserResult(
  appUser: AppUserDoc,
  authIdentity: AuthIdentityDoc | null,
  organization: OrganizationDoc | null,
  membership: MembershipDoc | null,
) {
  return toCurrentAppUserResult(appUser, authIdentity, organization, membership);
}
