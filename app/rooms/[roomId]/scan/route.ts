import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const proof = new URL(request.url).searchParams.get("proof");
  const browserKey = randomBytes(32).toString("base64url");
  let continuation: string | null = null;
  if (proof) {
    try {
      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
      continuation = await client.mutation(api.rooms.beginScan, { roomId: roomId as Id<"rooms">, proof, browserKey });
    } catch {
      // An invalid or unavailable proof can still lead staff to room controls.
    }
  }
  const response = NextResponse.redirect(new URL(`/rooms/${encodeURIComponent(roomId)}/check-in`, request.url));
  response.cookies.set("bara-room-scan", JSON.stringify({ roomId, browserKey, continuation }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 120,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
