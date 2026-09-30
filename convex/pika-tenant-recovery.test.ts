// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./api";
import { ensurePikaRosterOwner } from "./pikaIdentity";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const installationRef = "pika_recovery_installation";
const tenantRef = "pika_recovery_tenant";
const metadata = {
  requestId: "repair_one",
  operatorRef: "operator_one",
  reasonCode: "legacy_reset_removed_mapping",
  evidenceRef: "approved_scope_evidence_one",
  backupRef: "restricted_backup_one",
};

function makeTest() {
  return convexTest(schema, modules);
}

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const owner = await ensurePikaRosterOwner(ctx, {
      installationRef, tenantRef, principalRef: "principal_owner",
      displayName: "Owner", now: 1,
    });
    if (!owner.ok) throw new Error("Fixture failed");
    const mapping = await ctx.db.query("pika_installation_tenants").unique();
    await ctx.db.delete(mapping!._id);
    return { organizationId: owner.organization._id, appUserId: owner.appUser._id };
  });
  const scope = { installationRef, tenantRef, organizationId: ids.organizationId };
  vi.stubEnv("PIKA_TENANT_RECOVERY_SCOPE", JSON.stringify(scope));
  return { t, ids, scope };
}

async function retainedState(t: ReturnType<typeof makeTest>) {
  return t.run(async (ctx) => ({
    organizations: await ctx.db.query("organizations").collect(),
    users: await ctx.db.query("app_users").collect(),
    identities: await ctx.db.query("auth_identities").collect(),
    memberships: await ctx.db.query("organization_memberships").collect(),
    rosters: await ctx.db.query("rosters").collect(),
    occurrences: await ctx.db.query("attendance_occurrences").collect(),
  }));
}

describe("explicit Pika tenant recovery", () => {
  beforeEach(() => vi.stubEnv("PIKA_INTEGRATION_REF", installationRef));
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed with an actionable connection error instead of adopting an occupied slug", async () => {
    const { t } = await setup();
    const before = await retainedState(t);
    await expect(t.run((ctx) => ensurePikaRosterOwner(ctx, {
      installationRef, tenantRef, principalRef: "principal_owner", displayName: "Owner", now: 2,
    }))).rejects.toThrow("verify the tenant connection before operator recovery; do not adopt by slug");
    expect(await retainedState(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").collect())).toEqual([]);
  });

  it("inspects without writing and restores only the mapping and audit", async () => {
    const { t, scope } = await setup();
    const before = await retainedState(t);
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    expect(plan).toMatchObject({ memberCount: 1, staffCount: 1 });
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("pika_tenant_recovery_audits").collect())).toEqual([]);
    const args = { ...scope, ...metadata, planDigest: plan.planDigest };
    const result = await t.mutation(internal.pikaTenantRecovery.restore, args);
    expect(result.outcome).toBe("restored");
    expect(await retainedState(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").unique()))
      .toMatchObject(scope);
    expect(await t.mutation(internal.pikaTenantRecovery.restore, args)).toEqual(result);
    expect(await t.run((ctx) => ctx.db.query("pika_tenant_recovery_audits").collect())).toHaveLength(1);
    await expect(t.mutation(internal.pikaTenantRecovery.restore, { ...args, backupRef: "other_backup" }))
      .rejects.toThrow("prior audit");
  });

  it("does not authorize an occupied slug without the exact scope gate", async () => {
    const { t, scope } = await setup();
    vi.stubEnv("PIKA_TENANT_RECOVERY_SCOPE", "");
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("not authorized");
  });

  it("rejects different tenants and installations even with a matching organization", async () => {
    const { t, scope } = await setup();
    for (const change of [{ tenantRef: "other_tenant" }, { installationRef: "other_installation" }]) {
      await expect(t.query(internal.pikaTenantRecovery.inspect, { ...scope, ...change }))
        .rejects.toThrow("not authorized");
    }
  });

  it("rejects stale preflight state without inserting a mapping or audit", async () => {
    const { t, ids, scope } = await setup();
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    await t.run((ctx) => ctx.db.patch(ids.organizationId, { updatedAt: 2 }));
    await expect(t.mutation(internal.pikaTenantRecovery.restore, {
      ...scope, ...metadata, planDigest: plan.planDigest,
    })).rejects.toThrow("changed since inspection");
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("pika_tenant_recovery_audits").collect())).toEqual([]);
  });

  it("rejects an organization already claimed by another tenant", async () => {
    const { t, scope } = await setup();
    await t.run((ctx) => ctx.db.insert("pika_installation_tenants", {
      ...scope, tenantRef: "other_tenant", createdAt: 1, updatedAt: 1,
    }));
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("already exists");
  });

  it("rejects foreign or missing identity evidence", async () => {
    const { t, scope } = await setup();
    await t.run(async (ctx) => {
      const identity = await ctx.db.query("auth_identities").unique();
      await ctx.db.patch(identity!._id, { provisionedByInstallationRef: "other_installation" });
    });
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("identity evidence");
  });

  it("rejects disabled memberships", async () => {
    const { t, scope } = await setup();
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("organization_memberships").unique();
      await ctx.db.patch(membership!._id, { status: "disabled" });
    });
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("active");
  });

  it("resumes normal provisioning against the original workspace after repair", async () => {
    const { t, ids, scope } = await setup();
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    await t.mutation(internal.pikaTenantRecovery.restore, { ...scope, ...metadata, planDigest: plan.planDigest });
    const owner = await t.run((ctx) => ensurePikaRosterOwner(ctx, {
      installationRef, tenantRef, principalRef: "principal_owner", displayName: "Owner", now: 2,
    }));
    expect(owner.ok && owner.organization._id).toBe(ids.organizationId);
    expect(owner.ok && owner.appUser._id).toBe(ids.appUserId);
    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(1);
  });

  it("rejects an oversized inventory instead of approving a partial membership scan", async () => {
    const { t, ids, scope } = await setup();
    await t.run(async (ctx) => {
      for (let n = 0; n < 100; n += 1) {
        await ctx.db.insert("organization_memberships", {
          appUserId: ids.appUserId, organizationId: ids.organizationId,
          role: "student", status: "active", createdAt: 1, updatedAt: 1,
        });
      }
    });
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("bounded active membership");
  });

  it("rejects disabled retained users", async () => {
    const { t, ids, scope } = await setup();
    await t.run((ctx) => ctx.db.patch(ids.appUserId, { status: "disabled" }));
    await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("active retained users");
  });

  it("rejects identity changes after inspection", async () => {
    const { t, scope } = await setup();
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    await t.run(async (ctx) => {
      const identity = await ctx.db.query("auth_identities").unique();
      await ctx.db.patch(identity!._id, { providerSubject: `pika:${installationRef}:changed_principal` });
    });
    await expect(t.mutation(internal.pikaTenantRecovery.restore, {
      ...scope, ...metadata, planDigest: plan.planDigest,
    })).rejects.toThrow("changed since inspection");
  });

  it("does not report a historical successful audit as a currently restored connection", async () => {
    const { t, scope } = await setup();
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    const args = { ...scope, ...metadata, planDigest: plan.planDigest };
    await t.mutation(internal.pikaTenantRecovery.restore, args);
    await t.run(async (ctx) => {
      const mapping = await ctx.db.query("pika_installation_tenants").unique();
      await ctx.db.delete(mapping!._id);
    });
    await expect(t.mutation(internal.pikaTenantRecovery.restore, args)).rejects.toThrow("connection has changed");
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").collect())).toEqual([]);
  });

  it("rejects malformed gates and scope metadata", async () => {
    const { t, scope } = await setup();
    for (const raw of ["not-json", "null", "[]", JSON.stringify({ ...scope, unexpected: true })]) {
      vi.stubEnv("PIKA_TENANT_RECOVERY_SCOPE", raw);
      await expect(t.query(internal.pikaTenantRecovery.inspect, scope)).rejects.toThrow("not authorized");
    }
    vi.stubEnv("PIKA_TENANT_RECOVERY_SCOPE", JSON.stringify(scope));
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    await expect(t.mutation(internal.pikaTenantRecovery.restore, {
      ...scope, ...metadata, backupRef: "", planDigest: plan.planDigest,
    })).rejects.toThrow("metadata is invalid");
  });

  it("preserves tenant ownership and recovery audits through ledger retention", async () => {
    const { t, scope } = await setup();
    const plan = await t.query(internal.pikaTenantRecovery.inspect, scope);
    await t.mutation(internal.pikaTenantRecovery.restore, { ...scope, ...metadata, planDigest: plan.planDigest });
    const before = await retainedState(t);
    await t.mutation(internal.pikaRetention.cleanup, { now: Date.now() + 90 * 86_400_000 });
    expect(await retainedState(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("pika_installation_tenants").unique())).toMatchObject(scope);
    expect(await t.run((ctx) => ctx.db.query("pika_tenant_recovery_audits").collect())).toHaveLength(1);
  });
});
