import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

export async function roomScanApps(roomId: string, proof: string | null, poster: string | null) {
  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, { logger: false });
    return await client.query(api.rooms.scanApps, {
      roomId: roomId as Id<"rooms">,
      ...(poster ? { posterKey: poster } : proof ? { proof } : {}),
    });
  } catch {
    return null;
  }
}

export function roomScanParams(proof: string | null, poster: string | null) {
  return new URLSearchParams(poster ? { poster } : proof ? { proof } : {});
}
