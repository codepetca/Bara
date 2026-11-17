import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { roomScanApps, roomScanParams } from "@/lib/server/room-scan-apps";

export const metadata: Metadata = { referrer: "no-referrer" };

export default async function RoomCheckInApp({ params, searchParams }: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ proof?: string | string[]; poster?: string | string[] }>;
}) {
  const { roomId } = await params;
  const scan = await searchParams;
  const proof = typeof scan.proof === "string" ? scan.proof : null;
  const poster = typeof scan.poster === "string" ? scan.poster : null;
  const apps = await roomScanApps(roomId, proof, poster);
  const scanQuery = roomScanParams(proof, poster);
  const pika = apps && new URL(`/attendance/room/${encodeURIComponent(roomId)}/scan?${scanQuery}`, apps.pikaOrigin);
  scanQuery.set("app", "bara");
  const bara = `/rooms/${encodeURIComponent(roomId)}/scan?${scanQuery}`;
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-8">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h1 className="font-heading text-2xl font-semibold">Check in for attendance</h1>
        {pika ? (
          <>
            {apps.bara && <p className="text-sm text-text-muted">If you have classes in both apps, open each check-in.</p>}
            <div className="flex flex-col gap-3">
              <a className={buttonVariants({})} href={pika.href} target="_blank" rel="noreferrer">Check in with Pika</a>
              {apps.bara && <a className={buttonVariants({ variant: "outline" })} href={bara} target="_blank" rel="noreferrer">Check in with Bara</a>}
            </div>
          </>
        ) : <p>Scan the room QR again, or check in with your teacher.</p>}
      </Card>
    </main>
  );
}
