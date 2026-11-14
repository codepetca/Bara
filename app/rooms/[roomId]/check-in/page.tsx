import { RoomCheckInScreen } from "@/components/room-check-in-screen";
import { roomContext } from "./actions";

type RoomCheckInPageProps = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ staff?: string; closed?: string }>;
};

export default async function RoomCheckInPage({ params, searchParams }: RoomCheckInPageProps) {
  const { roomId } = await params;
  const { closed, staff } = await searchParams;
  const closedScan = closed === "1";
  const staffOnly = closedScan || staff === "1";
  const { context, scanId } = await roomContext(roomId, staffOnly);
  return (
    <RoomCheckInScreen
      key={`${roomId}:${scanId ?? "none"}:${staffOnly}:${closedScan}`}
      roomId={roomId}
      context={context}
      scanId={scanId}
      staffOnly={staffOnly}
      closedScan={closedScan}
    />
  );
}
