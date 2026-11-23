import { RoomDisplayScreen } from "@/components/room-display-screen";
import { RoomCheckInScreen } from "@/components/room-check-in-screen";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";
import { RoomDisplayUpdatePreview } from "./update-preview";

export default async function Review({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  ensureVisualRoutesEnabled();
  const { state } = await searchParams;
  if (state === "update") return <RoomDisplayUpdatePreview />;
  if (state === "scan") return <RoomCheckInScreen roomId="fixture" scanId="fixture" staffOnly={false} context={{ label: "Room 220", date: "2026-11-13", role: "both", canCheckIn: true, meetings: [], rosters: [] }} fixtureResult={{ status: "complete", results: [{ name: "Class A", code: "present_marked" }, { name: "Class B", code: "review_needed" }] }} />;
  return <RoomDisplayScreen
    roomId="fixture"
    registeredDisplay={{ label: "iPad 220", launchId: "fixture" }}
    fixture={{
      connected: state !== "disconnected",
      display: {
        label: state === "idle-empty" ? "223" : "Room 220",
        proof: state === "idle" || state === "idle-empty" ? null : "example",
        nextChangeAt: null,
        notices: state === "empty" || state === "idle-empty" ? [] : ["Welcome to class", "Today's agenda"],
      },
    }}
  />;
}
