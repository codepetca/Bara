"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { redeemRoomScan, type roomContext } from "@/app/rooms/[roomId]/check-in/actions";
import { useRouter } from "next/navigation";
import { useRoomDate } from "@/components/use-room-date";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

type Context = Awaited<ReturnType<typeof roomContext>>["context"];
type Result = Awaited<ReturnType<typeof redeemRoomScan>>;

function resultText(code: string) {
  switch (code) {
    case "present_marked":
      return "Checked in";
    case "already_present":
      return "Already checked in";
    case "already_late":
      return "Already checked in late";
    default:
      return "Please ask your teacher";
  }
}

type RoomCheckInProps = {
  roomId: string;
  context: Context;
  staffOnly: boolean;
  scanId: string | null;
  fixtureResult?: Result;
};

export function RoomCheckInScreen({ roomId, context, staffOnly, scanId, fixtureResult }: RoomCheckInProps) {
  const router = useRouter();
  const localDate = useRoomDate();
  const staleStaffContext = Boolean(!fixtureResult && context?.date && localDate && localDate !== context.date);
  useEffect(() => {
    if (staleStaffContext) router.refresh();
  }, [router, staleStaffContext]);
  const [choice, setChoice] = useState<"student" | "staff" | null>(null);
  const mode = choice ?? (staffOnly || context?.role === "staff" ? "staff" : context?.role === "both" ? "choose" : "student");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<{
    sessionId: Id<"sessions">;
    rosterId: Id<"rosters">;
    name: string;
    revision: number;
  } | null>(null);
  const [savedDefault, setSavedDefault] = useState<Id<"rosters"> | null>(null);
  const started = useRef(false);
  const move = useMutation(api.rooms.moveMeeting);
  const undo = useMutation(api.rooms.undoMove);
  const setDefault = useMutation(api.rooms.setDefault);

  useEffect(() => {
    if (mode !== "student" || !context?.canCheckIn || started.current) return;
    started.current = true;
    void (fixtureResult
      ? Promise.resolve(fixtureResult)
      : redeemRoomScan(roomId, scanId, choice === "student"))
      .then(setResult)
      .catch(() => setError("Could not check in. Please ask your teacher."));
  }, [mode, choice, context?.canCheckIn, roomId, scanId, fixtureResult]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("Could not complete that action. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveDefault(rosterId: Id<"rosters">) {
    void run(async () => {
      await setDefault({ rosterId, roomId: roomId as Id<"rooms"> });
      setSavedDefault(rosterId);
    });
  }

  let content;
  if (!context || (staffOnly && context.role === "student")) {
    content = <p>Check in with your teacher.</p>;
  } else if (mode === "choose") {
    content = <>
      <h2 className="font-heading text-xl font-semibold">What would you like to do?</h2>
      <div className="flex flex-col gap-3">
        <Button onClick={() => setChoice("student")}>Check in as student</Button>
        <Button variant="outline" onClick={() => setChoice("staff")}>Manage room</Button>
      </div>
    </>;
  } else if (mode === "student") {
    if (!context.canCheckIn || result?.status === "invalid") {
      content = <p>Scan the current room code, or check in with your teacher.</p>;
    } else if (error) {
      content = <p role="alert">{error}</p>;
    } else if (!result) {
      content = <p role="status">Checking you in…</p>;
    } else {
      content = <div className="space-y-2" role="status">
        <h2 className="font-heading text-xl font-semibold">Check-in result</h2>
        {result.results.length ? result.results.map((item, index) => (
          <p key={`${item.name}-${index}`}>{item.name}: {resultText(item.code)}</p>
        )) : <p>Check in with your teacher.</p>}
      </div>;
    }
  } else if (staleStaffContext) {
    content = <p role="status">Loading today’s meetings…</p>;
  } else if (moved) {
    content = <>
      <h2 className="font-heading text-xl font-semibold">Moved {moved.name} here</h2>
      <div className="flex flex-col gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          await undo({ sessionId: moved.sessionId, revision: moved.revision });
          setMoved(null);
        })}>Undo</Button>
        <Button variant="outline" disabled={busy || savedDefault === moved.rosterId}
          onClick={() => saveDefault(moved.rosterId)}>
          {savedDefault === moved.rosterId ? "Default room saved" : `Make ${context.label} the default`}
        </Button>
      </div>
    </>;
  } else {
    content = <>
      <h2 className="font-heading text-xl font-semibold">Manage room</h2>
      {context.meetings.length ? (
        <div className="flex flex-col gap-3">
          {context.meetings.map((meeting) => (
            <Button key={meeting.sessionId} disabled={busy} onClick={() => void run(async () => {
              const revision = await move({ roomId: roomId as Id<"rooms">, sessionId: meeting.sessionId });
              setMoved({ ...meeting, revision });
            })}>Move {meeting.name} here</Button>
          ))}
        </div>
      ) : context.rosters.length ? (
        <>
          <p className="text-sm text-slate-600">Set a default room for a class.</p>
          <div className="flex flex-col gap-3">
            {context.rosters.map((roster) => (
              <Button key={roster.rosterId} disabled={busy || savedDefault === roster.rosterId}
                onClick={() => saveDefault(roster.rosterId)}>
                {savedDefault === roster.rosterId ? "Default room saved" : `Set default for ${roster.name}`}
              </Button>
            ))}
          </div>
        </>
      ) : <p>No classes are available to manage.</p>}
    </>;
  }

  return (
    <PageShell title={context?.label ?? "Room"}>
      <Card className="space-y-5 p-6">
        {content}
        {error && mode === "staff" ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      </Card>
    </PageShell>
  );
}
