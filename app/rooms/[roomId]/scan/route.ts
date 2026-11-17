import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { searchParams } = new URL(request.url);
  const proof = searchParams.get("proof");
  const posterKey = searchParams.get("poster");
  const target = new URL(`/rooms/${encodeURIComponent(roomId)}/check-in`, request.url);
  const browserKey = randomBytes(32).toString("base64url");
  let continuation: string | null = null;
  if (!proof && !posterKey) {
    target.searchParams.set("closed", "1");
  } else {
    try {
      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
      const scanArgs = { roomId: roomId as Id<"rooms">, browserKey };
      if (posterKey) {
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
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (!continuation) {
    response.cookies.delete("bara-room-scan");
    return response;
  }

  response.cookies.set("bara-room-scan", JSON.stringify({ roomId, browserKey, continuation }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 120,
  });
  return response;
}
