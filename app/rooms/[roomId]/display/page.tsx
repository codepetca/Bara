import { RoomDisplayScreen } from "@/components/room-display-screen";

export default async function RoomDisplayPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomDisplayScreen roomId={roomId} />;
}
