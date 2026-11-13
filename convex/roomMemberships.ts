import { v } from "convex/values";
import { normalizeSchoolEmail, normalizeStudentId } from "./domain";
import type { Doc } from "./model";
import { applyParticipantLink } from "./participantLinks";
import { isStandaloneRoster } from "./roomModel";
import { internalMutation, type MutationCtx } from "./server";

/** Called through the deployment's operator CLI with a verified WorkOS user ID. */
export const authorize = internalMutation({
  args: {
    rosterId: v.id("rosters"),
    workosUserId: v.string(),
    role: v.union(v.literal("student"), v.literal("staff")),
    studentId: v.optional(v.string()),
    schoolEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster || roster.pikaDecommissioned || !(await isStandaloneRoster(ctx, roster._id)) ||
      (await ctx.db.get(roster.organizationId))?.status !== "active") {
      throw new Error("Choose an active standalone Bara roster.");
    }
    const providerSubject = args.workosUserId.trim();
    if (!/^user_[A-Za-z0-9_-]{1,123}$/.test(providerSubject)) throw new Error("Enter a WorkOS user ID.");
    const studentId = normalizeStudentId(args.studentId);
    const schoolEmail = normalizeSchoolEmail(args.schoolEmail);
    if (args.role === "student" && !studentId && !schoolEmail) {
      throw new Error("Enter the student's verified roster ID or school email.");
    }
    const prior = await ctx.db.query("room_membership_grants")
      .withIndex("by_providerSubject_and_organizationId", (q) =>
        q.eq("providerSubject", providerSubject).eq("organizationId", roster.organizationId))
      .unique();
    const grant = {
      providerSubject, organizationId: roster.organizationId, role: args.role,
      studentId: args.role === "student" ? studentId : undefined,
      schoolEmail: args.role === "student" ? schoolEmail : undefined,
    };
    if (prior) await ctx.db.replace(prior._id, grant);
    else await ctx.db.insert("room_membership_grants", grant);
    return null;
  },
});

export async function claimRoomMembershipGrants(
  ctx: MutationCtx,
  appUser: Doc<"app_users">,
  providerSubject: string,
) {
  if (appUser.status !== "active") return;
  const grants = await ctx.db.query("room_membership_grants")
    .withIndex("by_providerSubject_and_organizationId", (q) => q.eq("providerSubject", providerSubject))
    .take(20);
  const now = Date.now();

  for (const grant of grants) {
    const organization = await ctx.db.get(grant.organizationId);
    if (organization?.status !== "active") continue;
    const existing = await ctx.db.query("organization_memberships")
      .withIndex("by_appUserId_organizationId", (q) =>
        q.eq("appUserId", appUser._id).eq("organizationId", grant.organizationId))
      .unique();
    if (!existing) {
      await ctx.db.insert("organization_memberships", {
        appUserId: appUser._id, organizationId: grant.organizationId, role: grant.role,
        status: "active", studentId: grant.studentId, schoolEmail: grant.schoolEmail,
        createdAt: now, updatedAt: now,
      });
      if (grant.role === "staff") {
        await ctx.db.patch(appUser._id, { defaultOrganizationId: grant.organizationId, updatedAt: now });
      }
    } else if (existing.status === "active" && existing.role === "student" && grant.role === "student") {
      await ctx.db.patch(existing._id, {
        studentId: existing.studentId ?? grant.studentId,
        schoolEmail: existing.schoolEmail ?? grant.schoolEmail,
        updatedAt: now,
      });
    }
    await ctx.db.delete(grant._id);
  }
}

/** Allow an operator to configure a known staff member who is also a participant. */
export const linkStaffParticipant = internalMutation({
  args: { participantId: v.id("participants"), workosUserId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    const roster = participant ? await ctx.db.get(participant.rosterId) : null;
    if (!participant?.active || !roster || roster.pikaDecommissioned ||
      !(await isStandaloneRoster(ctx, roster._id)) ||
      (await ctx.db.get(roster.organizationId))?.status !== "active") {
      throw new Error("Choose an active participant in a standalone Bara roster.");
    }
    const identity = await ctx.db.query("auth_identities")
      .withIndex("by_provider_and_providerSubject", (q) =>
        q.eq("provider", "workos").eq("providerSubject", args.workosUserId)).unique();
    const user = identity ? await ctx.db.get(identity.appUserId) : null;
    if (!user || user.status !== "active") throw new Error("Staff member must sign in to Bara first.");
    const membership = await ctx.db.query("organization_memberships")
      .withIndex("by_appUserId_organizationId", (q) =>
        q.eq("appUserId", user._id).eq("organizationId", roster.organizationId)).unique();
    if (!membership || membership.status !== "active" || membership.role === "student") {
      throw new Error("Choose an active staff member in the roster's organization.");
    }
    if (participant.linkedAppUserId && participant.linkedAppUserId !== user._id) {
      throw new Error("This participant is already linked to another account.");
    }
    await applyParticipantLink(ctx, participant, {
      linkedAppUserId: user._id, linkStatus: "linked", linkMethod: "manual_staff",
    });
    return null;
  },
});
