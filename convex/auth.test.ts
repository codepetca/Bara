// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./api";
import type { Id } from "./model";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("shared identity bootstrap and roster authorization", () => {
  it("creates one app user, one auth identity, and a default organization membership on first authenticated bootstrap", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "user_teacher_1",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_teacher_1",
      email: "teacher@example.com",
      name: "Teacher One",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser.displayName).toBe("Teacher One");
    expect(currentUser.defaultOrganization?.role).toBe("admin");

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();
      const organizations = await ctx.db.query("organizations").collect();
      const memberships = await ctx.db.query("organization_memberships").collect();

      expect(appUsers).toHaveLength(1);
      expect(authIdentities).toHaveLength(1);
      expect(organizations).toHaveLength(1);
      expect(memberships).toHaveLength(1);
      expect(appUsers[0]?.defaultOrganizationId).toBe(organizations[0]?._id);
      expect(authIdentities[0]).toMatchObject({
        appUserId: currentUser._id,
        provider: "workos",
        providerSubject: "user_teacher_1",
        tokenIdentifier: "https://api.workos.com/user_management/client_test|user_teacher_1",
        issuer: "https://api.workos.com/user_management/client_test",
        emailSnapshot: "teacher@example.com",
        nameSnapshot: "Teacher One",
      });
      expect(memberships[0]).toMatchObject({
        appUserId: currentUser._id,
        organizationId: organizations[0]?._id,
        role: "admin",
        status: "active",
      });
    });
  });

  it("scopes roster list and roster detail to explicit roster access, not just authentication", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({
      subject: "user_owner_1",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_owner_1",
      email: "owner@example.com",
      name: "Owner One",
    });
    const stranger = t.withIdentity({
      subject: "user_owner_2",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_owner_2",
      email: "other@example.com",
      name: "Owner Two",
    });

    const rosterId = await owner.mutation(api.rosters.createEmpty, {
      name: "Homeroom",
    });
    await stranger.mutation(api.appUsers.ensureCurrent, {});

    expect(await owner.query(api.rosters.list, {})).toHaveLength(1);
    expect(await stranger.query(api.rosters.list, {})).toHaveLength(0);
    expect(await owner.query(api.rosters.getById, { rosterId })).not.toBeNull();
    expect(await stranger.query(api.rosters.getById, { rosterId })).toBeNull();
  });

  it("allows the same canonical user to hold different roles across organizations", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "user_multi_role_1",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_multi_role_1",
      email: "multi@example.com",
      name: "Multi Role User",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const appUser = await ctx.db.get(currentUser._id);
      if (!appUser?.defaultOrganizationId) {
        throw new Error("Expected default organization.");
      }

      const secondOrganizationId = await ctx.db.insert("organizations", {
        name: "Second Org",
        slug: "second-org",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.insert("organization_memberships", {
        appUserId: currentUser._id,
        organizationId: secondOrganizationId,
        role: "student",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });

      const memberships = await ctx.db
        .query("organization_memberships")
        .withIndex("by_appUserId_status", (q) =>
          q.eq("appUserId", currentUser._id).eq("status", "active"),
        )
        .collect();

      const roles = memberships
        .map((membership) => membership.role)
        .sort((left, right) => left.localeCompare(right));

      expect(roles).toEqual(["admin", "student"]);
    });
  });

  it("allows identities without email claims to bootstrap successfully", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "user_teacher_no_email",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_teacher_no_email",
      name: "No Email Teacher",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser).toMatchObject({
      displayName: "No Email Teacher",
      identity: {
        provider: "workos",
        name: "No Email Teacher",
      },
      defaultOrganization: {
        role: "admin",
      },
    });
    expect(currentUser.identity?.email).toBeUndefined();
  });

  it("stores WorkOS identities with a provider key derived from the issuer", async () => {
    const t = convexTest(schema, modules);
    const student = t.withIdentity({
      subject: "user_01JWORKOS",
      issuer: "https://api.workos.com/user_management",
      tokenIdentifier: "https://api.workos.com/user_management|user_01JWORKOS",
      email: "student@example.com",
      name: "WorkOS Student",
    });

    const currentUser = await student.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser.identity).toMatchObject({
      provider: "workos",
      email: "student@example.com",
      name: "WorkOS Student",
    });

    await t.run(async (ctx) => {
      const authIdentities = await ctx.db.query("auth_identities").collect();

      expect(authIdentities).toHaveLength(1);
      expect(authIdentities[0]).toMatchObject({
        appUserId: currentUser._id,
        provider: "workos",
        providerSubject: "user_01JWORKOS",
        tokenIdentifier: "https://api.workos.com/user_management|user_01JWORKOS",
        issuer: "https://api.workos.com/user_management",
      });
    });
  });

  it("links a new provider identity to an existing app user by verified email", async () => {
    const t = convexTest(schema, modules);
    const originalIdentity = t.withIdentity({
      subject: "user_original_1",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_original_1",
      email: "teacher@example.com",
      emailVerified: true,
      name: "Original Teacher",
    });
    const nextProviderIdentity = t.withIdentity({
      subject: "user_next_1",
      issuer: "https://login.example.com",
      tokenIdentifier: "https://login.example.com|user_next_1",
      email: "teacher@example.com",
      emailVerified: true,
      name: "Next Provider Teacher",
    });

    const originalUser = await originalIdentity.mutation(api.appUsers.ensureCurrent, {});
    const linkedUser = await nextProviderIdentity.mutation(api.appUsers.ensureCurrent, {});

    expect(linkedUser._id).toBe(originalUser._id);
    expect(linkedUser.displayName).toBe("Next Provider Teacher");

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();

      expect(appUsers).toHaveLength(1);
      expect(authIdentities).toHaveLength(2);
      expect(authIdentities.find((identity) => identity.providerSubject === "user_next_1")).toMatchObject({
        appUserId: originalUser._id,
        emailSnapshot: "teacher@example.com",
        emailVerifiedSnapshot: true,
        linkMethod: "verified_email",
      });
    });
  });

  it("does not link provider identities by unverified email", async () => {
    const t = convexTest(schema, modules);
    const originalIdentity = t.withIdentity({
      subject: "user_original_unverified_1",
      issuer: "https://api.workos.com/user_management/client_test",
      tokenIdentifier: "https://api.workos.com/user_management/client_test|user_original_unverified_1",
      email: "teacher@example.com",
      emailVerified: true,
      name: "Original Teacher",
    });
    const unverifiedIdentity = t.withIdentity({
      subject: "user_unverified_1",
      issuer: "https://login.example.com",
      tokenIdentifier: "https://login.example.com|user_unverified_1",
      email: "teacher@example.com",
      emailVerified: false,
      name: "Unverified Teacher",
    });

    const originalUser = await originalIdentity.mutation(api.appUsers.ensureCurrent, {});
    const unlinkedUser = await unverifiedIdentity.mutation(api.appUsers.ensureCurrent, {});

    expect(unlinkedUser._id).not.toBe(originalUser._id);

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();

      expect(appUsers).toHaveLength(2);
      expect(authIdentities).toHaveLength(2);
    });
  });

  it("can refresh an existing OIDC identity by provider subject without creating a duplicate user", async () => {
    const t = convexTest(schema, modules);
    const legacyIdentity = t.withIdentity({
      subject: "legacy-user-1",
      issuer: "https://login.legacy-idp.example.com",
      tokenIdentifier: "https://login.legacy-idp.example.com|legacy-user-1",
      email: "legacy@example.com",
      name: "Legacy Teacher",
    });

    let appUserId: Id<"app_users"> | null = null;
    await t.run(async (ctx) => {
      appUserId = await ctx.db.insert("app_users", {
        displayName: "Legacy",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.insert("auth_identities", {
        appUserId,
        provider: "oidc_login_legacy_idp_example_com",
        providerSubject: "legacy-user-1",
        tokenIdentifier: "legacy-token",
        emailSnapshot: "old@example.com",
        nameSnapshot: "Legacy",
        lastSeenAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const currentUser = await legacyIdentity.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser._id).toBe(appUserId);

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();

      expect(appUsers).toHaveLength(1);
      expect(authIdentities).toHaveLength(1);
      expect(authIdentities[0]).toMatchObject({
        appUserId,
        provider: "oidc_login_legacy_idp_example_com",
        providerSubject: "legacy-user-1",
        tokenIdentifier: "https://login.legacy-idp.example.com|legacy-user-1",
        issuer: "https://login.legacy-idp.example.com",
        emailSnapshot: "legacy@example.com",
        nameSnapshot: "Legacy Teacher",
      });
    });
  });
});
