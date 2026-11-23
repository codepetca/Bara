import { RoomDisplayScreen } from "@/components/room-display-screen";
import { roomDisplayVersion } from "@/lib/server/room-display-version";

export default async function RoomDisplayPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomDisplayScreen roomId={roomId} version={roomDisplayVersion()} />;
}
