import { v } from "convex/values";
import { sha256Hex, verifyV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import {
  displayCredentialPattern, displayPairingAlphabet, displayPairingBeginPath, displayPairingCodePattern,
  displayPairingHashPattern, displayPairingLifetime, displayPairingNetworkLimit,
} from "../lib/display-pairing";
import { createShareToken } from "../lib/session-links";
import { internal } from "./api";
import { listCurrentMemberships, requireCurrentAppUser } from "./auth";
import type { Doc, Id } from "./model";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./server";

export function displayPairingConfigured() {
  return (process.env.BARA_DISPLAY_PAIRING_SECRET?.length ?? 0) >= 32;
}

type DisplayState =
  | { state: "unpaired" }
  | { state: "waiting"; code: string; expiresAt: number }
  | { state: "paired"; roomId: Id<"rooms">; deviceLabel?: string }
  | { state: "registered"; deviceLabel: string };

const stateValidator = v.union(
  v.object({ state: v.literal("unpaired") }),
  v.object({ state: v.literal("waiting"), code: v.string(), expiresAt: v.number() }),
  v.object({ state: v.literal("paired"), roomId: v.id("rooms"), deviceLabel: v.optional(v.string()) }),
  v.object({ state: v.literal("registered"), deviceLabel: v.string() }),
);

async function displayState(ctx: QueryCtx, hash: string, now: number): Promise<DisplayState> {
  const device = await ctx.db.query("room_display_devices").withIndex("by_credentialHash", q => q.eq("credentialHash", hash)).unique();
  if (device && (await ctx.db.get(device.organizationId))?.status === "active") {
    const assigned = await effectiveRoom(ctx, device);
    return assigned ? { state: "paired", roomId: assigned._id, deviceLabel: device.label } : { state: "registered", deviceLabel: device.label };
  }
  const room = await ctx.db.query("rooms").withIndex("by_displayKeyHash", q => q.eq("displayKeyHash", hash)).unique();
  if (room && (await ctx.db.get(room.organizationId))?.status === "active") {
    return { state: "paired", roomId: room._id };
  }
  const setup = await ctx.db.query("room_display_pairings")
    .withIndex("by_credentialHash", q => q.eq("credentialHash", hash)).unique();
  if (setup && !setup.claimedRoomId && !setup.claimedDeviceId && setup.expiresAt > now) {
    return { state: "waiting", code: setup.code, expiresAt: setup.expiresAt };
  }
  return { state: "unpaired" };
}

export const status = query({
  args: { credential: v.string() },
  returns: stateValidator,
  handler: async (ctx, { credential }): Promise<DisplayState> => {
    if (!displayCredentialPattern.test(credential)) return { state: "unpaired" };
    return displayState(ctx, await sha256Hex(credential), Date.now());
  },
});

export const begin = mutation({
  args: { credentialHash: v.string(), source: v.string(), timestamp: v.string(), signature: v.string() },
  returns: v.union(v.literal("forbidden"), v.literal("rate_limited"), v.literal("ready")),
  handler: async (ctx, { credentialHash, source, timestamp, signature }) => {
    const secret = process.env.BARA_DISPLAY_PAIRING_SECRET;
    const now = Date.now();
    if (!secret || secret.length < 32 || !displayPairingHashPattern.test(credentialHash) ||
      !displayPairingHashPattern.test(source) || !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp) * 1000) >= 30_000 ||
      !await verifyV1RequestSignature({
        secret, method: "POST", path: displayPairingBeginPath, timestamp, nonce: source, body: credentialHash,
      }, signature)) return "forbidden";

    const current = await displayState(ctx, credentialHash, now);
    if (current.state !== "unpaired") return "ready";
    const limit = await ctx.db.query("room_display_issuance_limits").withIndex("by_source", q => q.eq("source", source)).unique();
    if (limit && limit.expiresAt > now) {
      if (limit.count >= displayPairingNetworkLimit) return "rate_limited";
      await ctx.db.patch(limit._id, { count: limit.count + 1 });
    } else {
      if (limit) await ctx.db.delete(limit._id);
      const expiresAt = now + displayPairingLifetime;
      const id = await ctx.db.insert("room_display_issuance_limits", { source, expiresAt, count: 1 });
      await ctx.scheduler.runAt(expiresAt, internal.displayPairing.expireIssuanceLimit, { id });
    }
    const previous = await ctx.db.query("room_display_pairings")
      .withIndex("by_credentialHash", q => q.eq("credentialHash", credentialHash)).unique();
    if (previous) await ctx.db.delete(previous._id);

    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const code = Array.from(bytes, byte => displayPairingAlphabet[byte % displayPairingAlphabet.length]).join("");
      const collision = await ctx.db.query("room_display_pairings").withIndex("by_code", q => q.eq("code", code)).unique();
      if (collision) continue;

      const expiresAt = now + displayPairingLifetime;
      const id = await ctx.db.insert("room_display_pairings", { credentialHash, code, expiresAt });
      await ctx.scheduler.runAt(expiresAt, internal.displayPairing.expireCode, { id });
      return "ready";
    }
    throw new Error("Could not create a pairing code.");
  },
});

export const expireIssuanceLimit = internalMutation({
  args: { id: v.id("room_display_issuance_limits") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
    return null;
  },
});

export const expireCode = internalMutation({
  args: { id: v.id("room_display_pairings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
    return null;
  },
});

export const expireLimit = internalMutation({
  args: { id: v.id("room_display_pairing_limits"), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, expiresAt }) => {
    const limit = await ctx.db.get(id);
    if (limit?.expiresAt === expiresAt) await ctx.db.delete(id);
    return null;
  },
});

async function countAttempt(ctx: MutationCtx, appUserId: Id<"app_users">, now: number) {
  const limit = await ctx.db.query("room_display_pairing_limits")
    .withIndex("by_appUserId", q => q.eq("appUserId", appUserId)).unique();
  if (limit && limit.expiresAt > now) {
    if (limit.attempts >= 12) return false;
    await ctx.db.patch(limit._id, { attempts: limit.attempts + 1 });
    return true;
  }
  const expiresAt = now + displayPairingLifetime;
  const id = limit?._id ?? await ctx.db.insert("room_display_pairing_limits", { appUserId, expiresAt, attempts: 1 });
  if (limit) await ctx.db.patch(id, { expiresAt, attempts: 1 });
  await ctx.scheduler.runAt(expiresAt, internal.displayPairing.expireLimit, { id, expiresAt });
  return true;
}

// The caller must authorize management of this room before claiming a code.
export async function claimDisplayCode(
  ctx: MutationCtx, room: Doc<"rooms">, appUserId: Id<"app_users">, code: string,
) {
  const now = Date.now();
  const setup = displayPairingCodePattern.test(code)
    ? await ctx.db.query("room_display_pairings").withIndex("by_code", q => q.eq("code", code)).unique()
    : null;

  if (setup && setup.expiresAt > now && setup.claimedRoomId === room._id &&
      setup.claimedBy === appUserId && setup.credentialHash === room.displayKeyHash) return "paired";
  if (!(await countAttempt(ctx, appUserId, now))) return "pairing_rate_limited";
  if (!setup || setup.expiresAt <= now || setup.claimedRoomId || setup.claimedDeviceId) return "pairing_code_invalid";

  // A receiver already paired to a different room needs a new credential to pair again.
  const existing = await ctx.db.query("rooms")
    .withIndex("by_displayKeyHash", q => q.eq("displayKeyHash", setup.credentialHash)).unique();
  if (existing) return "pairing_code_invalid";

  await ctx.db.patch(room._id, { displayKeyHash: setup.credentialHash, qrRevision: createShareToken() });
  await ctx.db.patch(setup._id, { claimedRoomId: room._id, claimedBy: appUserId });
  return "paired";
}

async function effectiveRoom(ctx: QueryCtx | MutationCtx, device: Doc<"room_display_devices">) {
  if (!device.roomId) return null;
  const room = await ctx.db.get(device.roomId);
  return room && room.organizationId === device.organizationId && !room.pikaInstallationRef &&
    room.displayKeyHash === device.credentialHash ? room : null;
}

async function requireAdmin(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const { appUser, authIdentity } = await requireCurrentAppUser(ctx);
  const membership = await ctx.db.query("organization_memberships")
    .withIndex("by_appUserId_organizationId", q => q.eq("appUserId", appUser._id).eq("organizationId", organizationId)).unique();
  const organization = await ctx.db.get(organizationId);
  if (authIdentity.provider !== "workos" || !membership || membership.status !== "active" || membership.role !== "admin" || organization?.status !== "active") {
    throw new Error("An active organization administrator is required.");
  }
  return appUser;
}

async function moveDevice(ctx: MutationCtx, device: Doc<"room_display_devices">, roomId: Id<"rooms"> | null) {
  const previous = await effectiveRoom(ctx, device);
  if (roomId === previous?._id) return;
  if (roomId) {
    const target = await ctx.db.get(roomId);
    if (!target || target.organizationId !== device.organizationId || target.pikaInstallationRef) throw new Error("Room is unavailable.");
    if (target.displayKeyHash) throw new Error("This room already has a display. Unpair it first.");
    await ctx.db.patch(target._id, { displayKeyHash: device.credentialHash, qrRevision: createShareToken() });
  }
  if (previous) await ctx.db.patch(previous._id, { displayKeyHash: undefined, qrRevision: createShareToken() });
  await ctx.db.patch(device._id, { roomId: roomId ?? undefined });
}

export const adminOptions = query({
  args: {},
  handler: async ctx => {
    const { appUser, authIdentity } = await requireCurrentAppUser(ctx);
    const memberships = await listCurrentMemberships(ctx, appUser._id);
    return { organizations: authIdentity.provider === "workos" ? memberships.filter(x => x.membership.role === "admin").map(x => ({ organizationId: x.organization._id, name: x.organization.name })) : [] };
  },
});

export const fleet = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requireAdmin(ctx, organizationId);
    const rooms = await ctx.db.query("rooms").withIndex("by_organizationId_installation_labelKey", q => q.eq("organizationId", organizationId).eq("pikaInstallationRef", undefined)).take(200);
    const devices = await ctx.db.query("room_display_devices").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).take(200);
    return {
      rooms: rooms.map(room => ({ roomId: room._id, label: room.label, occupied: Boolean(room.displayKeyHash) })),
      devices: await Promise.all(devices.map(async device => ({ deviceId: device._id, label: device.label, platform: device.platform,
        roomId: (await effectiveRoom(ctx, device))?._id ?? null, lastSeenAt: device.lastSeenAt ?? null, openedAt: device.openedAt ?? null }))),
    };
  },
});

export const register = mutation({
  args: { organizationId: v.id("organizations"), code: v.string(), label: v.string(),
    platform: v.union(v.literal("ipad"), v.literal("android"), v.literal("other")), roomId: v.union(v.id("rooms"), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx, args.organizationId);
    const label = args.label.trim().replace(/\s+/g, " ");
    if (!label || label.length > 80) throw new Error("Enter a display name of up to 80 characters.");
    const now = Date.now();
    const setup = displayPairingCodePattern.test(args.code) ? await ctx.db.query("room_display_pairings").withIndex("by_code", q => q.eq("code", args.code)).unique() : null;
    if (setup && setup.expiresAt > now && setup.claimedDeviceId && setup.claimedBy === user._id) {
      const existing = await ctx.db.get(setup.claimedDeviceId);
      if (existing?.organizationId === args.organizationId) return { deviceId: existing._id };
    }
    if (!await countAttempt(ctx, user._id, now)) return { error: "Too many attempts. Try again later." };
    if (!setup || setup.expiresAt <= now || setup.claimedRoomId || setup.claimedDeviceId ||
      await ctx.db.query("rooms").withIndex("by_displayKeyHash", q => q.eq("displayKeyHash", setup.credentialHash)).unique() ||
      await ctx.db.query("room_display_devices").withIndex("by_credentialHash", q => q.eq("credentialHash", setup.credentialHash)).unique()) {
      return { error: "This pairing code is invalid or expired." };
    }
    const deviceId = await ctx.db.insert("room_display_devices", { organizationId: args.organizationId, credentialHash: setup.credentialHash, label, platform: args.platform });
    const device = (await ctx.db.get(deviceId))!;
    await moveDevice(ctx, device, args.roomId);
    await ctx.db.patch(setup._id, { claimedDeviceId: deviceId, claimedBy: user._id });
    return { deviceId };
  },
});

export const assign = mutation({
  args: { organizationId: v.id("organizations"), deviceId: v.id("room_display_devices"), roomId: v.union(v.id("rooms"), v.null()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.organizationId);
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.organizationId !== args.organizationId) throw new Error("Display is unavailable.");
    await moveDevice(ctx, device, args.roomId);
    return null;
  },
});

export const report = mutation({
  args: { credential: v.string(), launchId: v.string(), roomId: v.union(v.id("rooms"), v.null()) },
  handler: async (ctx, args) => {
    if (!displayCredentialPattern.test(args.credential) || !args.launchId || args.launchId.length > 128) return null;
    const hash = await sha256Hex(args.credential);
    const device = await ctx.db.query("room_display_devices").withIndex("by_credentialHash", q => q.eq("credentialHash", hash)).unique();
    if (!device || (await ctx.db.get(device.organizationId))?.status !== "active") return null;
    const room = await effectiveRoom(ctx, device);
    if ((room?._id ?? null) !== args.roomId) return null;
    const now = Date.now();
    if (device.lastSeenAt !== undefined && now - device.lastSeenAt < 60_000) return null;
    if (device.launchId !== args.launchId) await ctx.db.patch(device._id, { launchId: args.launchId, openedAt: now, lastSeenAt: now });
    else await ctx.db.patch(device._id, { lastSeenAt: now });
    return null;
  },
});
