import { randomBytes } from "node:crypto";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { bootstrapCurrentAppUser } from "@/lib/server/bootstrap-current-app-user";
import { roomScanApps, roomScanParams } from "@/lib/server/room-scan-apps";

function scanRedirect(target: URL) {
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { searchParams } = new URL(request.url);
  const proof = searchParams.get("proof");
  const posterKey = searchParams.get("poster");
  const roomPath = `/rooms/${encodeURIComponent(roomId)}`;
  if ((proof || posterKey) && searchParams.get("app") !== "bara") {
    const apps = await roomScanApps(roomId, proof, posterKey);
    const scan = roomScanParams(proof, posterKey);
    if (apps) {
      const other = apps.bara
        ? new URL(`${roomPath}/check-in-app`, request.url)
        : new URL(`/attendance/room/${encodeURIComponent(roomId)}/scan`, apps.pikaOrigin);
      other.search = scan.toString();
      const response = scanRedirect(other);
      response.cookies.delete("bara-room-scan");
      return response;
    }
    if (posterKey) {
      scan.set("app", "bara");
      const bara = new URL(`${roomPath}/scan`, request.url);
      bara.search = scan.toString();
      return scanRedirect(bara);
    }
  }
  const target = new URL(`${roomPath}/check-in`, request.url);
  const browserKey = randomBytes(32).toString("base64url");
  let continuation: string | null = null;
  if (!proof && !posterKey) {
    target.searchParams.set("closed", "1");
  } else {
    const auth = posterKey ? (await withAuth({ ensureSignedIn: true })).accessToken : undefined;
    try {
      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false, ...(auth ? { auth } : {}) });
      const scanArgs = { roomId: roomId as Id<"rooms">, browserKey };
      if (posterKey) {
        if (!auth) throw new Error("Sign in to continue.");
        await bootstrapCurrentAppUser(auth);
        const result = await client.mutation(api.rooms.beginPosterScan, { ...scanArgs, posterKey });
        if (result.status === "captured") continuation = result.continuation;
        if (result.status === "closed") target.searchParams.set("closed", "1");
      } else if (proof) {
        continuation = await client.mutation(api.rooms.beginScan, { ...scanArgs, proof });
      }
    } catch {
      // An invalid or unavailable scan can still lead staff to room controls.
    }
  }
  const response = scanRedirect(target);
  if (!continuation) {
    response.cookies.delete("bara-room-scan");
    return response;
  }

  response.cookies.set("bara-room-scan", JSON.stringify({ roomId, browserKey, continuation }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 120,
  });
  return response;
}
