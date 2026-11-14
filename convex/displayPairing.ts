import { v } from "convex/values";
import { sha256Hex, verifyV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import {
  displayCredentialPattern, displayPairingAlphabet, displayPairingBeginPath, displayPairingCodePattern,
  displayPairingHashPattern, displayPairingLifetime, displayPairingNetworkLimit,
} from "../lib/display-pairing";
import { createShareToken } from "../lib/session-links";
import { internal } from "./api";
import type { Doc, Id } from "./model";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./server";

export function displayPairingConfigured() {
  return (process.env.BARA_DISPLAY_PAIRING_SECRET?.length ?? 0) >= 32;
}

type DisplayState =
  | { state: "unpaired" }
  | { state: "waiting"; code: string; expiresAt: number }
  | { state: "paired"; roomId: Id<"rooms"> };

const stateValidator = v.union(
  v.object({ state: v.literal("unpaired") }),
  v.object({ state: v.literal("waiting"), code: v.string(), expiresAt: v.number() }),
  v.object({ state: v.literal("paired"), roomId: v.id("rooms") }),
);

async function displayState(ctx: QueryCtx, hash: string, now: number): Promise<DisplayState> {
  const room = await ctx.db.query("rooms").withIndex("by_displayKeyHash", q => q.eq("displayKeyHash", hash)).unique();
  if (room && (await ctx.db.get(room.organizationId))?.status === "active") {
    return { state: "paired", roomId: room._id };
  }
  const setup = await ctx.db.query("room_display_pairings")
    .withIndex("by_credentialHash", q => q.eq("credentialHash", hash)).unique();
  if (setup && !setup.claimedRoomId && setup.expiresAt > now) {
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
  if (!setup || setup.expiresAt <= now || setup.claimedRoomId) return "pairing_code_invalid";

  // A receiver already paired to a different room needs a new credential to pair again.
  const existing = await ctx.db.query("rooms")
    .withIndex("by_displayKeyHash", q => q.eq("displayKeyHash", setup.credentialHash)).unique();
  if (existing) return "pairing_code_invalid";

  await ctx.db.patch(room._id, { displayKeyHash: setup.credentialHash, qrRevision: createShareToken() });
  await ctx.db.patch(setup._id, { claimedRoomId: room._id, claimedBy: appUserId });
  return "paired";
}
