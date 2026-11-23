"use client";

import { useState } from "react";
import { useRoomDisplayUpdate } from "@/components/use-room-display-update";

export function RoomDisplayUpdatePreview() {
  const [closed, setClosed] = useState(false);
  useRoomDisplayUpdate({
    version: "fixture-old",
    idle: closed,
    confirmIdle: async () => closed,
    reload: () => window.location.reload(),
  });

  return (
    <main>
      <p>{closed ? "Check-in is closed" : "Check-in is open"}</p>
      <button type="button" onClick={() => setClosed(true)}>Close check-in</button>
    </main>
  );
}
