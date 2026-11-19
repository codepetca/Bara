"use client";

import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { DisplayRoomEditor } from "@/components/display-room-editor";
import type { Id } from "@/convex/model";

export function DisplayAdminFixture({ state }: { state?: string }) {
  const client = {
    mutation: () => state === "busy" ? new Promise(() => {}) : state === "failure" ? Promise.reject(new Error("Fixture failure")) : Promise.resolve(null),
  } as unknown as ConvexReactClient;
  return <ConvexProvider client={client}>
    <DisplayRoomEditor organizationId={"fixture-org" as Id<"organizations">} schoolLocationName="PETHS"
      rooms={[
        { roomId: "fixture-220" as Id<"rooms">, label: "220", occupied: false },
        { roomId: "fixture-223" as Id<"rooms">, label: "223", occupied: true },
      ]} onClose={() => {}} />
  </ConvexProvider>;
}
