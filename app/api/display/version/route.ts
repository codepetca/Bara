import { roomDisplayVersion } from "@/lib/server/room-display-version";

export function GET() {
  return Response.json({ version: roomDisplayVersion() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
