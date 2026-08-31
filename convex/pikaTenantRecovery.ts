import { v } from "convex/values";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import type { Id } from "./model";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./server";

const REF = /^[A-Za-z0-9._~:-]{1,128}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_MEMBERS = 100;

const scopeArgs = {
  installationRef: v.string(),
  tenantRef: v.string(),
  organizationId: v.id("organizations"),
};

const planValidator = v.object({
  planDigest: v.string(),
  memberCount: v.number(),
  staffCount: v.number(),
});

type Scope = {
  installationRef: string;
  tenantRef: string;
  organizationId: Id<"organizations">;
};

function configuredScope(): Scope {
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(process.env.PIKA_TENANT_RECOVERY_SCOPE ?? "");
  } catch {
    throw new Error("Pika tenant recovery is not authorized.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Pika tenant recovery is not authorized.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.installationRef !== installationRef ||
    !REF.test(installationRef) ||
    typeof value.tenantRef !== "string" || !REF.test(value.tenantRef) ||
    typeof value.organizationId !== "string" || value.organizationId.length === 0 ||
    Object.keys(value).sort().join(",") !== "installationRef,organizationId,tenantRef"
  ) throw new Error("Pika tenant recovery is not authorized.");
  return value as Scope;
}

function assertScope(args: Scope) {
  const approved = configuredScope();
  if (
    args.installationRef !== approved.installationRef ||
    args.tenantRef !== approved.tenantRef ||
    args.organizationId !== approved.organizationId
  ) throw new Error("Pika tenant recovery is not authorized.");
}

async function recoveryPlan(ctx: QueryCtx | MutationCtx, scope: Scope) {
  assertScope(scope);
  const organization = await ctx.db.get(scope.organizationId);
  if (!organization || organization.status !== "active") {
    throw new Error("Pika tenant recovery requires an active organization.");
  }
  const tenantMapping = await ctx.db
    .query("pika_installation_tenants")
    .withIndex("by_installationRef_and_tenantRef", (q) =>
      q.eq("installationRef", scope.installationRef).eq("tenantRef", scope.tenantRef),
    ).unique();
  const organizationMappings = await ctx.db
    .query("pika_installation_tenants")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", scope.organizationId))
    .take(2);
  if (tenantMapping || organizationMappings.length > 0) {
    throw new Error("A Pika tenant connection already exists for the approved scope.");
  }
  const members = await ctx.db
    .query("organization_memberships")
    .withIndex("by_organizationId_status", (q) => q.eq("organizationId", scope.organizationId))
    .take(MAX_MEMBERS + 1);
  if (members.length === 0 || members.length > MAX_MEMBERS || members.some((row) => row.status !== "active")) {
    throw new Error("Pika tenant recovery requires a bounded active membership set.");
  }
  const identityEvidence = [];
  for (const member of members) {
    const user = await ctx.db.get(member.appUserId);
    if (!user || user.status !== "active") {
      throw new Error("Pika tenant recovery requires active retained users.");
    }
    const identities = await ctx.db.query("auth_identities")
      .withIndex("by_appUserId", (q) => q.eq("appUserId", member.appUserId)).take(8);
    const pikaIdentities = identities.filter((identity) => identity.provider === "pika");
    const matching = identities.filter((identity) =>
      identity.provider === "pika" &&
      identity.provisionedByInstallationRef === scope.installationRef &&
      identity.providerSubject.startsWith(`pika:${scope.installationRef}:`));
    if (matching.length !== 1 || pikaIdentities.length !== 1 || identities.length === 8) {
      throw new Error("Pika tenant recovery identity evidence is incomplete or ambiguous.");
    }
    identityEvidence.push({
      membershipId: member._id,
      identityId: matching[0]._id,
      identitySubject: matching[0].providerSubject,
      identityUpdatedAt: matching[0].updatedAt,
      appUserId: member.appUserId,
      userUpdatedAt: user.updatedAt,
      role: member.role,
      membershipUpdatedAt: member.updatedAt,
    });
  }
  identityEvidence.sort((a, b) => a.membershipId.localeCompare(b.membershipId));
  const evidence = {
    scope: {
      installationRef: scope.installationRef,
      tenantRef: scope.tenantRef,
      organizationId: scope.organizationId,
    },
    organization: {
      id: organization._id,
      status: organization.status,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    },
    identities: identityEvidence,
  };
  const staffCount = members.filter((row) => row.role === "staff" || row.role === "admin").length;
  if (staffCount === 0 || new Set(members.map((row) => row.appUserId)).size !== members.length) {
    throw new Error("Pika tenant recovery requires unambiguous retained staff membership.");
  }
  return {
    planDigest: await sha256Hex(JSON.stringify(evidence)),
    memberCount: members.length,
    staffCount,
  };
}

export const inspect = internalQuery({
  args: scopeArgs,
  returns: planValidator,
  handler: (ctx, args) => recoveryPlan(ctx, args),
});

export const restore = internalMutation({
  args: {
    ...scopeArgs,
    planDigest: v.string(),
    requestId: v.string(),
    operatorRef: v.string(),
    reasonCode: v.string(),
    evidenceRef: v.string(),
    backupRef: v.string(),
  },
  returns: v.object({ outcome: v.literal("restored"), restoredAt: v.number() }),
  handler: async (ctx, args) => {
    assertScope(args);
    for (const ref of [args.requestId, args.operatorRef, args.reasonCode, args.evidenceRef, args.backupRef]) {
      if (!REF.test(ref)) throw new Error("Pika tenant recovery metadata is invalid.");
    }
    if (!DIGEST.test(args.planDigest)) throw new Error("Pika tenant recovery plan is invalid.");
    const prior = await ctx.db.query("pika_tenant_recovery_audits")
      .withIndex("by_installationRef_and_requestId", (q) =>
        q.eq("installationRef", args.installationRef).eq("requestId", args.requestId),
      ).unique();
    if (prior) {
      if (
        prior.tenantRef !== args.tenantRef || prior.organizationId !== args.organizationId ||
        prior.operatorRef !== args.operatorRef || prior.reasonCode !== args.reasonCode ||
        prior.evidenceRef !== args.evidenceRef || prior.backupRef !== args.backupRef ||
        prior.planDigest !== args.planDigest
      ) throw new Error("Pika tenant recovery conflicts with its prior audit.");
      const mapping = await ctx.db.query("pika_installation_tenants")
        .withIndex("by_installationRef_and_tenantRef", (q) =>
          q.eq("installationRef", args.installationRef).eq("tenantRef", args.tenantRef),
        ).unique();
      if (mapping?.organizationId !== args.organizationId) {
        throw new Error("Previously restored Pika tenant connection has changed.");
      }
      return { outcome: "restored" as const, restoredAt: prior.restoredAt };
    }
    const plan = await recoveryPlan(ctx, args);
    if (plan.planDigest !== args.planDigest) {
      throw new Error("Pika tenant recovery state changed since inspection.");
    }
    const restoredAt = Date.now();
    await ctx.db.insert("pika_installation_tenants", {
      installationRef: args.installationRef,
      tenantRef: args.tenantRef,
      organizationId: args.organizationId,
      createdAt: restoredAt,
      updatedAt: restoredAt,
    });
    await ctx.db.insert("pika_tenant_recovery_audits", {
      installationRef: args.installationRef,
      tenantRef: args.tenantRef,
      organizationId: args.organizationId,
      requestId: args.requestId,
      operatorRef: args.operatorRef,
      reasonCode: args.reasonCode,
      evidenceRef: args.evidenceRef,
      backupRef: args.backupRef,
      planDigest: args.planDigest,
      memberCount: plan.memberCount,
      staffCount: plan.staffCount,
      restoredAt,
    });
    return { outcome: "restored" as const, restoredAt };
  },
});
