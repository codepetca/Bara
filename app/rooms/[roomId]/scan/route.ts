import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const proof = new URL(request.url).searchParams.get("proof");
  const target = new URL(`/rooms/${encodeURIComponent(roomId)}/check-in`, request.url);
  if (!proof) target.searchParams.set("closed", "1");
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (!proof) {
    response.cookies.delete("bara-room-scan");
    return response;
  }

  const browserKey = randomBytes(32).toString("base64url");
  let continuation: string | null = null;
  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
    continuation = await client.mutation(api.rooms.beginScan, { roomId: roomId as Id<"rooms">, proof, browserKey });
  } catch {
    // An invalid or unavailable proof can still lead staff to room controls.
  }
  response.cookies.set("bara-room-scan", JSON.stringify({ roomId, browserKey, continuation }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 120,
  });
  return response;
}
