"use client";

import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { displayHeartbeatInterval } from "@/lib/display-pairing";

export function RegisteredDisplayCheckIn({ credential, launchId, roomId }: {
  credential: string;
  launchId: string;
  roomId: Id<"rooms"> | null;
}) {
  const report = useMutation(api.displayPairing.report);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;

    async function checkIn() {
      let nextCheckIn = displayHeartbeatInterval;
      try {
        nextCheckIn = await report({ credential, launchId, roomId }) ?? nextCheckIn;
      } catch {
        // Attendance remains available if reporting fails. Retry on the next check-in.
      } finally {
        if (!disposed) timer = setTimeout(checkIn, nextCheckIn);
      }
    }

    void checkIn();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [credential, launchId, roomId, report]);

  return null;
}
