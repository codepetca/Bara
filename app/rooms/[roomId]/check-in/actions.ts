"use server";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { bootstrapCurrentAppUser } from "@/lib/server/bootstrap-current-app-user";

async function authenticatedClient() {
  const { accessToken } = await withAuth({ ensureSignedIn: true });
  if (!accessToken) throw new Error("Sign in to continue.");
  await bootstrapCurrentAppUser(accessToken);
  return new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { auth: accessToken, logger: false });
}

async function scanCookie(roomId: string) {
  try {
    const value = (await cookies()).get("bara-room-scan")?.value;
    const scan = JSON.parse(value ?? "null");
    if (scan?.roomId === roomId && typeof scan.browserKey === "string" && typeof scan.continuation === "string") return scan as { browserKey: string; continuation: string };
  } catch { /* Treat malformed cookies as an absent scan. */ }
  return null;
}

export async function roomContext(roomId: string, staffOnly: boolean) {
  const client = await authenticatedClient();
  const scan = staffOnly ? null : await scanCookie(roomId);
  const context = await client.query(api.rooms.scanContext, { roomId: roomId as Id<"rooms">, ...(scan ?? {}) });
  return { context, scanId: scan?.continuation ?? null };
}

export async function redeemRoomScan(roomId: string, expectedScanId: string | null, asStudent = false) {
  const client = await authenticatedClient();
  const scan = await scanCookie(roomId);
  if (!scan || !expectedScanId || scan.continuation !== expectedScanId) return { status: "invalid" as const, results: [] };
  return client.mutation(api.rooms.redeemScan, { roomId: roomId as Id<"rooms">, ...scan, ...(asStudent ? { asStudent } : {}) });
}
