"use client";

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
import QRCode from "react-qr-code";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import { displayPairingCodePattern, normalizeDisplayPairingCode } from "@/lib/display-pairing";
import type { Id } from "@/convex/model";

export default function RoomsPage({ params }: { params: Promise<{ rosterId: string }> }) {
  const { rosterId } = use(params);
  const id = rosterId as Id<"rosters">;
  const data = useQuery(api.rooms.listForRoster, { rosterId: id });
  const create = useMutation(api.rooms.create);
  const setDefault = useMutation(api.rooms.setDefault);
  const pair = useMutation(api.rooms.pairDisplay);
  const pairByCode = useMutation(api.rooms.pairDisplayByCode);
  const revoke = useMutation(api.rooms.revokeDisplay);
  const setNotices = useMutation(api.rooms.setNotices);
  const [label, setLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [displayUrl, setDisplayUrl] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [pairedRoom, setPairedRoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update room.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, key: string) {
    await run(async () => {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    });
  }

  return (
    <PageShell title="Rooms" backHref={`/rosters/${rosterId}`}>
      {data === undefined ? (
        <Card>Loading rooms…</Card>
      ) : !data.supported ? (
        <Card>Room check-in is unavailable for this roster.</Card>
      ) : (
        <>
          <Card className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Add a room</h2>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await create({ rosterId: id, label: label.trim() });
                  setLabel("");
                });
              }}
            >
              <input
                aria-label="Room name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Room name"
                className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-2"
              />
              <Button type="submit" disabled={busy || !label.trim()}>Add</Button>
            </form>
          </Card>
          {data.rooms.map((room) => {
            const staffUrl = typeof window === "undefined" ? "" : `${window.location.origin}/rooms/${room.roomId}/check-in?staff=1`;
            const notices = drafts[room.roomId] ?? room.notices.join("\n");
            const pairingCode = normalizeDisplayPairingCode(codes[room.roomId] ?? "");
            return (
              <Card key={room.roomId} className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-heading text-lg font-semibold">{room.label}</h2>
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => setDefault({
                    rosterId: id,
                    roomId: data.defaultRoomId === room.roomId ? null : room.roomId,
                  }))}>
                    {data.defaultRoomId === room.roomId ? "Default room ✓" : "Set default"}
                  </Button>
                </div>
                {room.canManage && room.paired && <p className="text-sm text-text-muted">Pairing a new display disconnects the current one.</p>}
                <div className="flex flex-wrap gap-2">
                  {room.canManage ? (
                    <>
                      <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                        const credential = await pair({ rosterId: id, roomId: room.roomId });
                        setPairedRoom(null);
                        setDisplayUrl(`${window.location.origin}/rooms/${room.roomId}/display#${credential}`);
                      })}>{data.shortCodePairing ? "Create pairing link instead" : "Create display pairing link"}</Button>
                      <Button variant="outline" disabled={busy || !room.paired} onClick={() => void run(async () => {
                        await revoke({ rosterId: id, roomId: room.roomId });
                        setDisplayUrl("");
                        setPairedRoom(null);
                      })}>Disconnect display</Button>
                    </>
                  ) : null}
                  <Button variant="outline" disabled={busy} onClick={() => void copy(staffUrl, room.roomId)}>
                    {copied === room.roomId ? "Copied" : "Copy staff shortcut"}
                  </Button>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-slate-700">Show staff sticker</summary>
                  {staffUrl ? (
                    <div className="mt-3 w-48 space-y-2 rounded-2xl bg-white p-3">
                      <QRCode value={staffUrl} aria-label={`Staff shortcut for ${room.label}`} className="h-auto w-full" />
                      <p className="text-center text-sm font-medium">{room.label} · Staff</p>
                    </div>
                  ) : null}
                </details>
                {displayUrl.includes(`/rooms/${room.roomId}/`) ? (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-600">Open this link on the room display. Pairing again replaces it.</p>
                    <a href={displayUrl} target="_blank" rel="noreferrer" className="block break-all text-sm text-slate-700 underline">{displayUrl}</a>
                    <Button variant="outline" onClick={() => void copy(displayUrl, "display")}>
                      {copied === "display" ? "Copied" : "Copy display link"}
                    </Button>
                  </div>
                ) : null}
                {room.canManage && data.shortCodePairing ? (
                  <div className="space-y-2">
                    <p className="text-sm">Open <a href="/display" target="_blank" rel="noreferrer" className="underline">/display</a> on the room screen, then enter its code.</p>
                    <label htmlFor={`pairing-code-${room.roomId}`} className="block text-sm font-medium">Display pairing code</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id={`pairing-code-${room.roomId}`}
                        value={codes[room.roomId] ?? ""}
                        maxLength={15}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        onChange={(event) => setCodes({ ...codes, [room.roomId]: event.target.value })}
                        className="w-44 rounded-2xl border border-slate-300 px-4 py-2"
                      />
                      <Button disabled={busy || !displayPairingCodePattern.test(pairingCode)}
                        onClick={() => void run(async () => {
                          setPairedRoom(null);
                          const result = await pairByCode({ rosterId: id, roomId: room.roomId, code: pairingCode });
                          if (result === "pairing_code_invalid") throw new Error("This code is invalid or expired. Get a new code on the display.");
                          if (result === "pairing_rate_limited") throw new Error("Too many pairing attempts. Try again in a few minutes.");
                          setCodes(current => ({ ...current, [room.roomId]: "" }));
                          setDisplayUrl("");
                          setPairedRoom(room.roomId);
                        })}>Pair display</Button>
                    </div>
                    {pairedRoom === room.roomId && <p role="status">Paired {room.label}.</p>}
                  </div>
                ) : null}
                {room.canManage ? (
                  <div className="space-y-2">
                    <label htmlFor={`notices-${room.roomId}`} className="block text-sm font-medium">Announcements</label>
                    <textarea
                      id={`notices-${room.roomId}`}
                      rows={3}
                      value={notices}
                      onChange={(event) => setDrafts({ ...drafts, [room.roomId]: event.target.value })}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-2"
                      placeholder="One announcement per line"
                    />
                    <Button variant="outline" disabled={busy} onClick={() => void run(() => setNotices({
                      rosterId: id,
                      roomId: room.roomId,
                      notices: notices.split("\n").map((line) => line.trim()).filter(Boolean),
                    }))}>Save announcements</Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
      {error ? <Card className="text-sm text-rose-700" role="alert">{error}</Card> : null}
    </PageShell>
  );
}
