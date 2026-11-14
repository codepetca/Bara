import type { Metadata } from "next";
import { RoomDisplayReceiver } from "@/components/room-display-receiver";

export const metadata: Metadata = {
  title: "Room display | Bara",
  robots: { index: false, follow: false },
};

export default function DisplayPage() {
  return <RoomDisplayReceiver />;
}
