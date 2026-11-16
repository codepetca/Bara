"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

type Room = { roomId: Id<"rooms">; label: string; occupied: boolean };
type Edit = { mode: "rename" | "remove"; room: Room };
const inputClass = "min-w-0 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3";

export function DisplayRoomEditor({ organizationId, deviceId, rooms, onClose }: {
  organizationId: Id<"organizations">;
  deviceId: Id<"room_display_devices">;
  rooms: Room[];
  onClose: () => void;
}) {
  const addRoom = useMutation(api.displayPairing.addRoom);
  const renameRoom = useMutation(api.displayPairing.renameRoom);
  const removeRoom = useMutation(api.displayPairing.removeRoom);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (edit?.mode === "rename") nameInput.current?.focus();
    else heading.current?.focus();
  }, [edit]);

  async function save(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : fallback);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(next: Edit | null) {
    setEdit(next);
    setRename(next?.room.label ?? "");
    setError(null);
    setNotice(null);
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} closeDisabled={busy} panelClassName="max-h-[85dvh] overflow-y-auto rounded-[28px]">
      <Card className="space-y-4 bg-white" onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = event.currentTarget.querySelectorAll<HTMLElement>("button:enabled, input:enabled");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const focused = document.activeElement;
        if (event.shiftKey ? focused === first || focused === heading.current : focused === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}>
        <div className="flex items-center justify-between gap-3">
          <h2 ref={heading} tabIndex={-1} id={titleId} className="font-heading text-xl font-semibold">Edit rooms</h2>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Done</Button>
        </div>

        {edit?.mode === "remove" ? (
          <div className="space-y-3">
            <p className="text-sm">Remove {edit.room.label}?{edit.room.occupied ? " Its display will be unassigned." : ""}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => startEdit(null)} disabled={busy}>Cancel</Button>
              <Button variant="danger" disabled={busy} onClick={() => void save(async () => {
                await removeRoom({ organizationId, roomId: edit.room.roomId });
                setEdit(null);
                setNotice("Room removed.");
              }, "Could not remove the room.")}>Remove room</Button>
            </div>
          </div>
        ) : edit?.mode === "rename" ? (
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (busy || !rename.trim()) return;
            void save(async () => {
              await renameRoom({ organizationId, roomId: edit.room.roomId, name: rename });
              setEdit(null);
              setNotice("Room renamed.");
            }, "Could not rename the room.");
          }}>
            <label className="block space-y-1 text-sm font-medium">Room name
              <input ref={nameInput} className={inputClass} value={rename} maxLength={80} required disabled={busy}
                onChange={(event) => setRename(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !rename.trim() || rename.trim() === edit.room.label}>Save name</Button>
              <Button type="button" variant="outline" onClick={() => startEdit(null)} disabled={busy}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <form className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              if (busy || !newName.trim()) return;
              void save(async () => {
                await addRoom({ organizationId, deviceId, name: newName });
                setNewName("");
                setNotice("Room added.");
              }, "Could not add the room.");
            }}>
              <label className="block space-y-1 text-sm font-medium">Room name
                <input ref={nameInput} className={inputClass} value={newName} maxLength={80} required disabled={busy}
                  onChange={(event) => setNewName(event.target.value)} />
              </label>
              <Button type="submit" className="w-full" disabled={busy || !newName.trim()}>Add room</Button>
            </form>
            {rooms.length > 0 && (
              <ul className="divide-y divide-slate-200">
                {rooms.map((room) => (
                  <li key={room.roomId} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2">
                    <span className="min-w-0 break-all text-sm font-medium">{room.label}</span>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" aria-label={`Rename ${room.label}`} disabled={busy}
                        onClick={() => startEdit({ mode: "rename", room })}>Rename</Button>
                      <Button size="sm" variant="outline" aria-label={`Remove ${room.label}`} disabled={busy}
                        onClick={() => startEdit({ mode: "remove", room })}>Remove</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
      </Card>
    </Dialog>
  );
}
