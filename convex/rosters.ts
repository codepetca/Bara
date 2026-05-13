import { v } from "convex/values";
import { buildDemoRosterStudents } from "../lib/demo-data";
import { normalizeStudent } from "../lib/students";
import {
  ensureCurrentAppUser,
  getCurrentAppUserWithIdentity,
  listCurrentMemberships,
  requireAccessibleRoster,
  requireCurrentOrganizationMembership,
} from "./auth";
import { getParticipantType, normalizeSchoolEmail, normalizeStudentId } from "./domain";
import {
  autoLinkParticipant,
  resolveParticipantLink,
  syncParticipantAttendanceRecords,
} from "./participantLinks";
import { scheduleConfigValidator } from "./scheduleConfig";
import { upsertManagedSchedule } from "./scheduleState";
import type { Id } from "./model";
import { mutation, query, type MutationCtx, type QueryCtx } from "./server";

const importedStudentValidator = v.object({
  studentId: v.optional(v.string()),
  schoolEmail: v.optional(v.string()),
  rawName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  displayName: v.string(),
  sortKey: v.string(),
});

const seedSmokeTestResultValidator = v.object({
  rosterId: v.id("rosters"),
  rosterName: v.string(),
  teacherAppUserId: v.id("app_users"),
  teacherEmail: v.optional(v.string()),
  studentAppUserId: v.id("app_users"),
  studentMembershipId: v.id("organization_memberships"),
  studentEmail: v.string(),
  studentId: v.string(),
});

function requireStaffAccessRole(role: "student" | "staff" | "admin") {
  if (role === "student") {
    throw new Error("Students cannot manage rosters.");
  }

  return role === "admin" ? "admin" : "staff";
}

function getRosterMode(roster: { mode?: "standalone" | "pika_linked" }) {
  return roster.mode ?? "standalone";
}

function isSeedDataEnabled() {
  const raw = process.env.TAPCHECK_ENABLE_SEED_DATA?.trim().toLocaleLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function requireSeedDataEnabled() {
  if (!isSeedDataEnabled()) {
    throw new Error("Seed data is disabled. Set TAPCHECK_ENABLE_SEED_DATA=true in the Convex deployment.");
  }
}

function getSeedValue(value: string | undefined, envName: string, fallback: string) {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }

  const envValue = process.env[envName]?.trim();
  return envValue || fallback;
}

function getRequiredSeedEmail(value: string | undefined, envName: string) {
  const email = normalizeSchoolEmail(value ?? process.env[envName]);
  if (!email) {
    throw new Error(`${envName} or studentEmail is required for smoke-test seed data.`);
  }

  return email;
}

function buildSeedTokenIdentifier(email: string) {
  return `seed:workos:${email}`;
}

async function loadRosterParticipants(ctx: QueryCtx | MutationCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("participants")
    .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
    .collect();
}

function mapParticipantsByIdentifiers(
  participants: Array<{
    _id: Id<"participants">;
    externalId?: string;
    schoolEmail?: string;
    linkedAppUserId?: Id<"app_users">;
  }>,
) {
  const duplicateStudentIds = new Set<string>();
  const duplicateSchoolEmails = new Set<string>();
  const participantsByStudentId = new Map<string, (typeof participants)[number]>();
  const participantsBySchoolEmail = new Map<string, (typeof participants)[number]>();

  for (const participant of participants) {
    if (!participant.externalId) {
      continue;
    }

    if (participantsByStudentId.has(participant.externalId)) {
      duplicateStudentIds.add(participant.externalId);
    } else {
      participantsByStudentId.set(participant.externalId, participant);
    }
  }

  for (const participant of participants) {
    if (!participant.schoolEmail) {
      continue;
    }

    if (participantsBySchoolEmail.has(participant.schoolEmail)) {
      duplicateSchoolEmails.add(participant.schoolEmail);
      continue;
    }

    participantsBySchoolEmail.set(participant.schoolEmail, participant);
  }

  if (duplicateStudentIds.size > 0) {
    const ids = [...duplicateStudentIds].sort().join(", ");
    throw new Error(`Roster already contains duplicate student IDs: ${ids}.`);
  }

  if (duplicateSchoolEmails.size > 0) {
    const emails = [...duplicateSchoolEmails].sort().join(", ");
    throw new Error(`Roster already contains duplicate school emails: ${emails}.`);
  }

  return {
    participantsByStudentId,
    participantsBySchoolEmail,
  };
}

function validateImportedStudents(students: Array<{ studentId?: string; schoolEmail?: string }>) {
  if (students.length === 0) {
    throw new Error("At least one valid student is required.");
  }

  const duplicateIds = new Set<string>();
  const duplicateEmails = new Set<string>();
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  for (const student of students) {
    const normalizedStudentId = normalizeStudentId(student.studentId);
    const normalizedSchoolEmail = normalizeSchoolEmail(student.schoolEmail);

    if (!normalizedStudentId && !normalizedSchoolEmail) {
      throw new Error("Each imported student must have a student ID or school email.");
    }

    if (normalizedStudentId) {
      if (seenIds.has(normalizedStudentId)) {
        duplicateIds.add(normalizedStudentId);
      }

      seenIds.add(normalizedStudentId);
    }

    if (normalizedSchoolEmail) {
      if (seenEmails.has(normalizedSchoolEmail)) {
        duplicateEmails.add(normalizedSchoolEmail);
      }

      seenEmails.add(normalizedSchoolEmail);
    }
  }

  if (duplicateIds.size > 0) {
    throw new Error("Duplicate student IDs were found in the import.");
  }

  if (duplicateEmails.size > 0) {
    throw new Error("Duplicate school emails were found in the import.");
  }
}

function findExistingParticipantForImport(
  identifierMaps: ReturnType<typeof mapParticipantsByIdentifiers>,
  student: { studentId?: string; schoolEmail?: string },
) {
  const normalizedStudentId = normalizeStudentId(student.studentId);
  const normalizedSchoolEmail = normalizeSchoolEmail(student.schoolEmail);
  const matchByStudentId = normalizedStudentId
    ? identifierMaps.participantsByStudentId.get(normalizedStudentId)
    : undefined;
  const matchBySchoolEmail = normalizedSchoolEmail
    ? identifierMaps.participantsBySchoolEmail.get(normalizedSchoolEmail)
    : undefined;

  if (matchByStudentId && matchBySchoolEmail && matchByStudentId._id !== matchBySchoolEmail._id) {
    throw new Error("Roster import identifiers conflict with existing participants.");
  }

  return matchByStudentId ?? matchBySchoolEmail ?? null;
}

async function findAccessibleRosterMembership(
  ctx: QueryCtx,
  appUserId: Id<"app_users">,
  roster: { _id: Id<"rosters">; organizationId: Id<"organizations"> },
) {
  const memberships = await listCurrentMemberships(ctx, appUserId);

  for (const { membership } of memberships) {
    if (membership.organizationId !== roster.organizationId) {
      continue;
    }

    const access = await ctx.db
      .query("roster_access")
      .withIndex("by_rosterId_membershipId", (q) =>
        q.eq("rosterId", roster._id).eq("membershipId", membership._id),
      )
      .unique();

    if (access) {
      return membership;
    }
  }

  return null;
}

async function listAccessibleRosters(ctx: QueryCtx, appUserId: Id<"app_users">) {
  const memberships = await listCurrentMemberships(ctx, appUserId);
  const accessibleRosterIds = new Set<Id<"rosters">>();

  for (const { membership } of memberships) {
    const rosterAccessRows = await ctx.db
      .query("roster_access")
      .withIndex("by_membershipId", (q) => q.eq("membershipId", membership._id))
      .collect();

    for (const rosterAccess of rosterAccessRows) {
      accessibleRosterIds.add(rosterAccess.rosterId);
    }
  }

  const rosters = await Promise.all([...accessibleRosterIds].map((rosterId) => ctx.db.get(rosterId)));

  return rosters
    .filter((roster): roster is NonNullable<typeof roster> => roster !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

async function hasActiveStudentMembership(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  appUserId: Id<"app_users">,
) {
  const membership = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", appUserId).eq("organizationId", organizationId),
    )
    .unique();

  return Boolean(membership && membership.status === "active" && membership.role === "student");
}

async function getUniqueAppUserIdByVerifiedEmail(ctx: MutationCtx, email: string) {
  const identities = await ctx.db
    .query("auth_identities")
    .withIndex("by_emailSnapshot", (q) => q.eq("emailSnapshot", email))
    .take(20);

  const verifiedIdentities = identities.filter(
    (identity) => identity.emailVerifiedSnapshot === true,
  );
  const appUserIds = Array.from(new Set(verifiedIdentities.map((identity) => identity.appUserId)));

  if (appUserIds.length > 1) {
    throw new Error(`Multiple verified users already exist for ${email}.`);
  }

  return appUserIds[0] ?? null;
}

async function getUniqueStudentMembershipAppUserId(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  email: string,
) {
  const memberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_organizationId_and_schoolEmail", (q) =>
      q.eq("organizationId", organizationId).eq("schoolEmail", email),
    )
    .take(20);

  const studentMemberships = memberships.filter(
    (membership) => membership.status === "active" && membership.role === "student",
  );
  const appUserIds = Array.from(new Set(studentMemberships.map((membership) => membership.appUserId)));

  if (appUserIds.length > 1) {
    throw new Error(`Multiple student memberships already exist for ${email}.`);
  }

  return appUserIds[0] ?? null;
}

async function ensureSeedAuthIdentity(
  ctx: MutationCtx,
  args: {
    appUserId: Id<"app_users">;
    email: string;
    displayName: string;
    now: number;
  },
) {
  const tokenIdentifier = buildSeedTokenIdentifier(args.email);
  const existing = await ctx.db
    .query("auth_identities")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();

  if (existing) {
    if (existing.appUserId !== args.appUserId) {
      throw new Error(`Seed identity for ${args.email} is linked to another app user.`);
    }

    await ctx.db.patch(existing._id, {
      emailSnapshot: args.email,
      emailVerifiedSnapshot: true,
      nameSnapshot: args.displayName,
      lastSeenAt: args.now,
      updatedAt: args.now,
    });
    return existing._id;
  }

  return await ctx.db.insert("auth_identities", {
    appUserId: args.appUserId,
    provider: "workos",
    providerSubject: `seed:${args.email}`,
    tokenIdentifier,
    issuer: "seed:tapcheck:workos",
    emailSnapshot: args.email,
    emailVerifiedSnapshot: true,
    nameSnapshot: args.displayName,
    linkMethod: "bootstrap",
    lastSeenAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function ensureSeedStudentAppUser(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    email: string;
    displayName: string;
    now: number;
  },
) {
  const existingByVerifiedEmail = await getUniqueAppUserIdByVerifiedEmail(ctx, args.email);
  const existingByMembership =
    existingByVerifiedEmail ??
    (await getUniqueStudentMembershipAppUserId(ctx, args.organizationId, args.email));

  if (existingByMembership) {
    const appUser = await ctx.db.get(existingByMembership);
    if (!appUser) {
      throw new Error("Seed student app user was not found.");
    }

    if (appUser.status !== "active" || appUser.displayName !== args.displayName) {
      await ctx.db.patch(appUser._id, {
        displayName: args.displayName,
        status: "active",
        updatedAt: args.now,
      });
    }

    await ensureSeedAuthIdentity(ctx, {
      appUserId: appUser._id,
      email: args.email,
      displayName: args.displayName,
      now: args.now,
    });
    return appUser._id;
  }

  const appUserId = await ctx.db.insert("app_users", {
    displayName: args.displayName,
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
  });

  await ensureSeedAuthIdentity(ctx, {
    appUserId,
    email: args.email,
    displayName: args.displayName,
    now: args.now,
  });

  return appUserId;
}

async function ensureSeedStudentMembership(
  ctx: MutationCtx,
  args: {
    appUserId: Id<"app_users">;
    organizationId: Id<"organizations">;
    studentId: string;
    studentEmail: string;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", args.appUserId).eq("organizationId", args.organizationId),
    )
    .unique();

  if (existing) {
    if (existing.role !== "student") {
      throw new Error("Seed student already has a non-student membership in this organization.");
    }

    await ctx.db.patch(existing._id, {
      status: "active",
      studentId: args.studentId,
      schoolEmail: args.studentEmail,
      updatedAt: args.now,
    });
    return existing._id;
  }

  return await ctx.db.insert("organization_memberships", {
    appUserId: args.appUserId,
    organizationId: args.organizationId,
    role: "student",
    status: "active",
    studentId: args.studentId,
    schoolEmail: args.studentEmail,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function ensureRosterAccess(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    membershipId: Id<"organization_memberships">;
    accessRole: "staff" | "admin";
    now: number;
  },
) {
  const existing = await ctx.db
    .query("roster_access")
    .withIndex("by_rosterId_membershipId", (q) =>
      q.eq("rosterId", args.rosterId).eq("membershipId", args.membershipId),
    )
    .unique();

  if (existing) {
    if (existing.accessRole !== args.accessRole) {
      await ctx.db.patch(existing._id, {
        accessRole: args.accessRole,
        updatedAt: args.now,
      });
    }
    return existing._id;
  }

  return await ctx.db.insert("roster_access", {
    rosterId: args.rosterId,
    membershipId: args.membershipId,
    accessRole: args.accessRole,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function findRosterByName(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  rosterName: string,
) {
  const rosters = await ctx.db
    .query("rosters")
    .withIndex("by_organizationId_createdAt", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(100);

  return rosters.find((roster) => roster.name === rosterName) ?? null;
}

async function ensureSmokeTestRoster(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    createdByAppUserId: Id<"app_users">;
    creatorMembershipId: Id<"organization_memberships">;
    creatorRole: "student" | "staff" | "admin";
    rosterName: string;
    now: number;
  },
) {
  const existing = await findRosterByName(ctx, args.organizationId, args.rosterName);
  if (existing) {
    await ensureRosterAccess(ctx, {
      rosterId: existing._id,
      membershipId: args.creatorMembershipId,
      accessRole: requireStaffAccessRole(args.creatorRole),
      now: args.now,
    });
    return existing._id;
  }

  const rosterId = await ctx.db.insert("rosters", {
    organizationId: args.organizationId,
    createdByAppUserId: args.createdByAppUserId,
    name: args.rosterName,
    mode: "standalone",
    createdAt: args.now,
    updatedAt: args.now,
  });

  await ensureRosterAccess(ctx, {
    rosterId,
    membershipId: args.creatorMembershipId,
    accessRole: requireStaffAccessRole(args.creatorRole),
    now: args.now,
  });

  return rosterId;
}

async function buildVerifiedCheckInSummary(
  ctx: QueryCtx,
  roster: { organizationId: Id<"organizations"> },
  participants: Array<{
    externalId?: string;
    schoolEmail?: string;
    linkedAppUserId?: Id<"app_users">;
  }>,
) {
  let readyStudents = 0;
  let linkedStudents = 0;
  let missingIdentifierStudents = 0;
  let reviewNeededStudents = 0;

  for (const participant of participants) {
    if (participant.linkedAppUserId) {
      linkedStudents += 1;

      if (await hasActiveStudentMembership(ctx, roster.organizationId, participant.linkedAppUserId)) {
        readyStudents += 1;
      } else {
        reviewNeededStudents += 1;
      }

      continue;
    }

    if (!participant.externalId && !participant.schoolEmail) {
      missingIdentifierStudents += 1;
      continue;
    }

    const resolution = await resolveParticipantLink(ctx, roster.organizationId, {
      studentId: participant.externalId,
      schoolEmail: participant.schoolEmail,
    });

    if (resolution.kind === "matched") {
      readyStudents += 1;
    } else {
      reviewNeededStudents += 1;
    }
  }

  return {
    totalStudents: participants.length,
    readyStudents,
    linkedStudents,
    missingIdentifierStudents,
    reviewNeededStudents,
  };
}

async function createParticipant(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    studentId?: string;
    schoolEmail?: string;
    rawName: string;
    firstName: string;
    lastName: string;
    displayName: string;
    sortKey: string;
    now: number;
  },
) {
  return ctx.db.insert("participants", {
    rosterId: args.rosterId,
    externalId: normalizeStudentId(args.studentId),
    schoolEmail: normalizeSchoolEmail(args.schoolEmail),
    rawName: args.rawName,
    firstName: args.firstName,
    lastName: args.lastName,
    displayName: args.displayName,
    sortKey: args.sortKey,
    participantType: "roster_only",
    linkStatus: "unlinked",
    active: true,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("rosters"),
      name: v.string(),
      mode: v.union(v.literal("standalone"), v.literal("pika_linked")),
      createdAt: v.number(),
      studentCount: v.number(),
      sessionCount: v.number(),
      hasActiveSession: v.boolean(),
      latestSessionId: v.optional(v.id("sessions")),
    }),
  ),
  handler: async (ctx) => {
    const { appUser } = await getCurrentAppUserWithIdentity(ctx);
    if (!appUser) {
      return [];
    }

    const rosters = await listAccessibleRosters(ctx, appUser._id);

    return Promise.all(
      rosters.map(async (roster) => {
        const [participants, sessions] = await Promise.all([
          ctx.db
            .query("participants")
            .withIndex("by_rosterId_active_sortKey", (q) =>
              q.eq("rosterId", roster._id).eq("active", true),
            )
            .collect(),
          ctx.db
            .query("sessions")
            .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", roster._id))
            .collect(),
        ]);

        const latestSession = sessions.sort((left, right) => right.createdAt - left.createdAt)[0];

        return {
          _id: roster._id,
          name: roster.name,
          mode: getRosterMode(roster),
          createdAt: roster.createdAt,
          studentCount: participants.length,
          sessionCount: sessions.length,
          hasActiveSession: sessions.some((session) => session.status === "open"),
          latestSessionId: latestSession?._id,
        };
      }),
    );
  },
});

export const getById = query({
  args: { rosterId: v.id("rosters") },
  returns: v.union(
    v.null(),
    v.object({
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
        mode: v.union(v.literal("standalone"), v.literal("pika_linked")),
        createdAt: v.number(),
      }),
      students: v.array(
        v.object({
          _id: v.id("participants"),
          studentId: v.string(),
          schoolEmail: v.optional(v.string()),
          rawName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          displayName: v.string(),
          active: v.boolean(),
          linkStatus: v.union(
            v.literal("linked"),
            v.literal("unlinked"),
            v.literal("ambiguous"),
            v.literal("review_needed"),
          ),
          linkedAppUserId: v.optional(v.id("app_users")),
        }),
      ),
      sessions: v.array(
        v.object({
          _id: v.id("sessions"),
          title: v.string(),
          date: v.string(),
          status: v.union(v.literal("open"), v.literal("closed")),
          checkInToken: v.string(),
          createdAt: v.number(),
        }),
      ),
      verifiedCheckIn: v.object({
        totalStudents: v.number(),
        readyStudents: v.number(),
        linkedStudents: v.number(),
        missingIdentifierStudents: v.number(),
        reviewNeededStudents: v.number(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const [{ appUser }, roster] = await Promise.all([
      getCurrentAppUserWithIdentity(ctx),
      ctx.db.get(args.rosterId),
    ]);

    if (!appUser || !roster) {
      return null;
    }

    const membership = await findAccessibleRosterMembership(ctx, appUser._id, roster);
    if (!membership) {
      return null;
    }

    const [participants, sessions] = await Promise.all([
      ctx.db
        .query("participants")
        .withIndex("by_rosterId_active_sortKey", (q) =>
          q.eq("rosterId", args.rosterId).eq("active", true),
        )
        .collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);
    const verifiedCheckIn = await buildVerifiedCheckInSummary(ctx, roster, participants);

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
        mode: getRosterMode(roster),
        createdAt: roster.createdAt,
      },
      students: participants.map((participant) => ({
        _id: participant._id,
        studentId: participant.externalId ?? "",
        schoolEmail: participant.schoolEmail,
        rawName: participant.rawName,
        firstName: participant.firstName,
        lastName: participant.lastName,
        displayName: participant.displayName,
        active: participant.active,
        linkStatus: participant.linkStatus,
        linkedAppUserId: participant.linkedAppUserId,
      })),
      sessions: sessions
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((session) => ({
          _id: session._id,
          title: session.title,
          date: session.date,
          status: session.status,
          checkInToken: session.checkInToken,
          createdAt: session.createdAt,
        })),
      verifiedCheckIn,
    };
  },
});

export const createEmpty = mutation({
  args: { name: v.string() },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name,
      mode: "standalone",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    return rosterId;
  },
});

export const importCsv = mutation({
  args: {
    name: v.string(),
    students: v.array(importedStudentValidator),
    managedSchedule: v.optional(scheduleConfigValidator),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name,
      mode: "standalone",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    for (const student of args.students) {
      const participantId = await createParticipant(ctx, {
        rosterId,
        studentId: student.studentId,
        schoolEmail: student.schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      const roster = await ctx.db.get(rosterId);
      if (participant && roster) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
      }
    }

    if (args.managedSchedule) {
      await upsertManagedSchedule(ctx, {
        rosterId,
        config: args.managedSchedule,
      });
    }

    return rosterId;
  },
});

export const rename = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    await ctx.db.patch(args.rosterId, { name, updatedAt: Date.now() });
    return null;
  },
});

export const importIntoExisting = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
    students: v.array(importedStudentValidator),
    deactivateMissing: v.optional(v.boolean()),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const existingParticipants = await loadRosterParticipants(ctx, args.rosterId);
    const identifierMaps = mapParticipantsByIdentifiers(existingParticipants);
    const now = Date.now();
    const matchedParticipantIds = new Set<Id<"participants">>();

    await ctx.db.patch(args.rosterId, { name, updatedAt: now });

    for (const student of args.students) {
      const studentId = normalizeStudentId(student.studentId);
      const schoolEmail = normalizeSchoolEmail(student.schoolEmail);
      const existingParticipant = findExistingParticipantForImport(identifierMaps, {
        studentId,
        schoolEmail,
      });
      if (existingParticipant) {
        matchedParticipantIds.add(existingParticipant._id);
        await ctx.db.patch(existingParticipant._id, {
          externalId: studentId,
          schoolEmail,
          rawName: student.rawName,
          firstName: student.firstName,
          lastName: student.lastName,
          displayName: student.displayName,
          sortKey: student.sortKey,
          participantType: getParticipantType(existingParticipant.linkedAppUserId),
          active: true,
          updatedAt: now,
        });
        const refreshedParticipant = await ctx.db.get(existingParticipant._id);
        if (refreshedParticipant) {
          await autoLinkParticipant(ctx, roster, refreshedParticipant, appUser._id);
          await syncParticipantAttendanceRecords(ctx, refreshedParticipant);
        }
          continue;
      }

      const participantId = await createParticipant(ctx, {
        rosterId: args.rosterId,
        studentId,
        schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      if (participant) {
        matchedParticipantIds.add(participant._id);
        await autoLinkParticipant(ctx, roster, participant, appUser._id);
      }
    }

    if (args.deactivateMissing) {
      for (const existingParticipant of existingParticipants) {
        if (matchedParticipantIds.has(existingParticipant._id) || !existingParticipant.active) {
          continue;
        }

        await ctx.db.patch(existingParticipant._id, {
          active: false,
          updatedAt: now,
        });
      }
    }

    return args.rosterId;
  },
});

export const seedDemo = mutation({
  args: {},
  returns: v.id("rosters"),
  handler: async (ctx) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name: "Grade 8 Homeroom Demo",
      mode: "standalone",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    const roster = await ctx.db.get(rosterId);
    if (!roster) {
      throw new Error("Demo roster could not be created.");
    }

    for (const student of buildDemoRosterStudents()) {
      const participantId = await createParticipant(ctx, {
        rosterId,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      if (participant) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
      }
    }

    return rosterId;
  },
});

export const seedSmokeTest = mutation({
  args: {
    rosterName: v.optional(v.string()),
    studentEmail: v.optional(v.string()),
    studentId: v.optional(v.string()),
    studentName: v.optional(v.string()),
  },
  returns: seedSmokeTestResultValidator,
  handler: async (ctx, args) => {
    requireSeedDataEnabled();

    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const now = Date.now();
    const rosterName = getSeedValue(
      args.rosterName,
      "TAPCHECK_SEED_ROSTER_NAME",
      "Tapcheck QR Smoke Test",
    );
    const studentEmail = getRequiredSeedEmail(args.studentEmail, "TAPCHECK_SEED_STUDENT_EMAIL");
    const studentId = getSeedValue(args.studentId, "TAPCHECK_SEED_STUDENT_ID", "9001");
    const studentName = getSeedValue(
      args.studentName,
      "TAPCHECK_SEED_STUDENT_NAME",
      "Smoke Test Student",
    );

    const teacherEmail = currentUser.identity?.email;
    if (teacherEmail && normalizeSchoolEmail(teacherEmail) === studentEmail) {
      throw new Error("Smoke-test student email must be different from the creator email.");
    }

    const student = normalizeStudent(studentName, studentId, studentEmail);
    if (!student.studentId || !student.schoolEmail) {
      throw new Error("Smoke-test student must have both a student ID and school email.");
    }

    validateImportedStudents([student]);

    const studentAppUserId = await ensureSeedStudentAppUser(ctx, {
      organizationId: organization._id,
      email: student.schoolEmail,
      displayName: student.displayName,
      now,
    });
    const studentMembershipId = await ensureSeedStudentMembership(ctx, {
      appUserId: studentAppUserId,
      organizationId: organization._id,
      studentId: student.studentId,
      studentEmail: student.schoolEmail,
      now,
    });
    const rosterId = await ensureSmokeTestRoster(ctx, {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      creatorMembershipId: membership._id,
      creatorRole: membership.role,
      rosterName,
      now,
    });
    const roster = await ctx.db.get(rosterId);
    if (!roster) {
      throw new Error("Smoke-test roster could not be created.");
    }

    const existingParticipants = await loadRosterParticipants(ctx, rosterId);
    const existingParticipant = findExistingParticipantForImport(
      mapParticipantsByIdentifiers(existingParticipants),
      {
        studentId: student.studentId,
        schoolEmail: student.schoolEmail,
      },
    );

    if (existingParticipant) {
      await ctx.db.patch(existingParticipant._id, {
        externalId: student.studentId,
        schoolEmail: student.schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        participantType: getParticipantType(existingParticipant.linkedAppUserId),
        active: true,
        updatedAt: now,
      });
      const participant = await ctx.db.get(existingParticipant._id);
      if (participant) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
        await syncParticipantAttendanceRecords(ctx, participant);
      }
    } else {
      const participantId = await createParticipant(ctx, {
        rosterId,
        studentId: student.studentId,
        schoolEmail: student.schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });
      const participant = await ctx.db.get(participantId);
      if (participant) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
      }
    }

    return {
      rosterId,
      rosterName,
      teacherAppUserId: currentUser._id,
      teacherEmail,
      studentAppUserId,
      studentMembershipId,
      studentEmail: student.schoolEmail,
      studentId: student.studentId,
    };
  },
});

export const remove = mutation({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const [participants, sessions, rosterAccessRows, rosterSchedules, rosterClassDays, externalLinks] =
      await Promise.all([
      loadRosterParticipants(ctx, args.rosterId),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
      ctx.db
        .query("roster_access")
        .withIndex("by_rosterId", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
      ctx.db
        .query("roster_schedules")
        .withIndex("by_rosterId", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
      ctx.db
        .query("roster_class_days")
        .withIndex("by_rosterId_and_date", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
      ctx.db
        .query("roster_external_links")
        .withIndex("by_rosterId", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);

    for (const session of sessions) {
      const [attendanceRows, attendanceEvents] = await Promise.all([
        ctx.db
          .query("attendance_records")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect(),
        ctx.db
          .query("attendance_events")
          .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
          .collect(),
      ]);

      for (const attendance of attendanceRows) {
        await ctx.db.delete(attendance._id);
      }

      for (const attendanceEvent of attendanceEvents) {
        await ctx.db.delete(attendanceEvent._id);
      }

      await ctx.db.delete(session._id);
    }

    for (const participant of participants) {
      await ctx.db.delete(participant._id);
    }

    for (const rosterAccess of rosterAccessRows) {
      await ctx.db.delete(rosterAccess._id);
    }

    for (const rosterSchedule of rosterSchedules) {
      await ctx.db.delete(rosterSchedule._id);
    }

    for (const rosterClassDay of rosterClassDays) {
      await ctx.db.delete(rosterClassDay._id);
    }

    for (const externalLink of externalLinks) {
      await ctx.db.delete(externalLink._id);
    }

    await ctx.db.delete(args.rosterId);
    return null;
  },
});
