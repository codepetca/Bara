"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { displayPairingCodePattern, normalizeDisplayPairingCode } from "@/lib/display-pairing";

const field = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900";
type Platform = "ipad" | "android" | "other";
type RoomOption = { roomId: Id<"rooms">; label: string; occupied: boolean };
type RoomChoice = { roomId: string; newRoomName: string | null };
const noRoom: RoomChoice = { roomId: "", newRoomName: null };

function roomChoiceIsValid(choice: RoomChoice, rooms: RoomOption[]) {
  if (choice.newRoomName !== null) return Boolean(choice.newRoomName.trim());
  return !choice.roomId || rooms.some((room) => room.roomId === choice.roomId);
}

function roomAssignment(choice: RoomChoice) {
  if (choice.newRoomName !== null) return { roomId: null, newRoomName: choice.newRoomName.trim() };
  return { roomId: choice.roomId ? choice.roomId as Id<"rooms"> : null };
}

function RoomField({ label, emptyLabel, rooms, choice, onChange, busy }: {
  label: string;
  emptyLabel: string;
  rooms: RoomOption[];
  choice: RoomChoice;
  onChange: (choice: RoomChoice) => void;
  busy: boolean;
}) {
  const addingRoom = choice.newRoomName !== null;
  const valid = roomChoiceIsValid(choice, rooms);

  return <div className="space-y-2">
    {addingRoom ? (
      <label className="block space-y-2 text-sm font-medium">Room name
        <input className={field} value={choice.newRoomName ?? ""} maxLength={80} required disabled={busy}
          onChange={(event) => onChange({ ...choice, newRoomName: event.target.value })} />
      </label>
    ) : (
      <label className="block space-y-2 text-sm font-medium">{label}
        <select className={field} value={choice.roomId} disabled={busy}
          onChange={(event) => onChange({ ...choice, roomId: event.target.value })}>
          <option value="">{emptyLabel}</option>
          {!valid && <option value={choice.roomId} disabled>Room no longer available</option>}
          {rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.label}</option>)}
        </select>
      </label>
    )}
    {!addingRoom && !valid && <p role="alert" className="text-sm text-rose-700">That room is no longer available. Choose another room or clear the selection.</p>}
    <Button type="button" variant="outline" disabled={busy}
      onClick={() => onChange({ ...choice, newRoomName: addingRoom ? null : "" })}>
      {addingRoom ? "Cancel new room" : "Add a room"}
    </Button>
  </div>;
}

export function DisplayAdmin({ setup = false, initialCode = "", initialOrganizationId }: { setup?: boolean; initialCode?: string; initialOrganizationId?: string }) {
  const router = useRouter();
  const { isReady, bootstrapError } = useCurrentAppUser();
  const options = useQuery(api.displayPairing.adminOptions, isReady ? {} : "skip");
  const [chosenOrg, setChosenOrg] = useState(initialOrganizationId ?? "");
  const organizations = options?.organizations ?? [];
  const organizationId = (organizations.find((org) => org.organizationId === chosenOrg)?.organizationId ?? organizations[0]?.organizationId) as Id<"organizations"> | undefined;
  const fleet = useQuery(api.displayPairing.fleet, organizationId ? { organizationId } : "skip");
  const register = useMutation(api.displayPairing.register);
  const assign = useMutation(api.displayPairing.assign);
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<Platform>("ipad");
  const [room, setRoom] = useState<RoomChoice>(noRoom);
  const [draftRooms, setDraftRooms] = useState<Record<string, RoomChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalizedCode = normalizeDisplayPairingCode(code);
  const availableRooms = fleet?.rooms.filter((room) => !room.occupied) ?? [];
  const canRegister = Boolean(label.trim()) && displayPairingCodePattern.test(normalizedCode) && roomChoiceIsValid(room, availableRooms);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "";
      setError(message || fallback);
    } finally { setBusy(false); }
  }

  return <PageShell title={setup ? "Register display" : "Displays"} titleContainerClassName="pl-9 pr-24 sm:px-20">
    {bootstrapError ? <Card role="alert">{bootstrapError}</Card> : !isReady || options === undefined ? <Card>Loading displays…</Card> : organizations.length === 0 ? <Card>No organizations available to manage displays.</Card> : <>
      {organizations.length > 1 && <Card><label className="block space-y-2 text-sm font-medium">Organization<select className={field} value={organizationId} disabled={busy} onChange={(event) => { setChosenOrg(event.target.value); setRoom(noRoom); setDraftRooms({}); setError(null); }}>
        {organizations.map((org) => <option key={org.organizationId} value={org.organizationId}>{org.name}</option>)}
      </select></label></Card>}
      {fleet === undefined ? <Card>Loading displays…</Card> : setup ? <Card>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (busy || !organizationId || !canRegister) return; void run(async () => {
          const result = await register({ organizationId, code: normalizedCode, label: label.trim(), platform, ...roomAssignment(room) });
          if (result.error) {
            throw new Error(result.error.toLowerCase().includes("attempt") ? result.error : "This code is invalid, expired, or already used. Get a new code on the display.");
          }
          router.push(`/displays?organizationId=${encodeURIComponent(organizationId)}`);
        }, "Could not register this display. Check the code and try again."); }}>
          <label className="block space-y-2 text-sm font-medium">Display code<input className={field} value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
          <label className="block space-y-2 text-sm font-medium">Name or asset tag<input className={field} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required /></label>
          <label className="block space-y-2 text-sm font-medium">Display type<select className={field} value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}><option value="ipad">iPad</option><option value="android">Android</option><option value="other">Other</option></select></label>
          <RoomField label="Room" emptyLabel="Register without room" rooms={availableRooms} choice={room} onChange={setRoom} busy={busy} />
          <Button type="submit" className="w-full" disabled={busy || !canRegister}>{busy ? "Registering…" : "Register display"}</Button>
          <p className="text-sm text-slate-600">Codes expire after a few minutes. If a code has expired or was already used, get a new one on the display.</p>
        </form>
      </Card> : <>
        <Card className="space-y-3"><h2 className="font-heading text-lg font-semibold">Register a display</h2><p className="text-sm text-slate-600">Open Bara on the display, then scan its code or enter it here.</p><Link className={buttonVariants({ variant: "outline" })} href="/displays/setup">Enter a code</Link></Card>
        {fleet.devices.length === 0 ? <Card>No displays registered yet.</Card> : fleet.devices.map((device) => {
          const rooms = fleet.rooms.filter((room) => !room.occupied || room.roomId === device.roomId);
          const draft = draftRooms[device.deviceId] ?? { roomId: device.roomId ?? "", newRoomName: null };
          const changed = draft.newRoomName !== null || draft.roomId !== (device.roomId ?? "");
          return <Card key={device.deviceId} className="space-y-3">
            <div><h2 className="font-heading text-lg font-semibold">{device.label}</h2><p className="text-sm text-slate-600">{device.platform === "ipad" ? "iPad" : device.platform === "android" ? "Android" : "Other"}</p></div>
            <p className="text-sm text-slate-600">Last seen: {formatTime(device.lastSeenAt)} · Launch reported: {formatTime(device.openedAt)}</p>
            <RoomField label={`Room for ${device.label}`} emptyLabel="No room" rooms={rooms} choice={draft} busy={busy}
              onChange={(choice) => setDraftRooms((current) => ({ ...current, [device.deviceId]: choice }))} />
            <Button variant="outline" disabled={busy || !changed || !roomChoiceIsValid(draft, rooms)} onClick={() => void run(async () => {
              await assign({ organizationId: organizationId!, deviceId: device.deviceId, ...roomAssignment(draft) });
              setDraftRooms((current) => { const next = { ...current }; delete next[device.deviceId]; return next; });
              setNotice(`Updated ${device.label}.`);
            }, "Could not update this display.")}>Save room</Button>
          </Card>;
        })}
      </>}
      {error && <Card role="alert" className="text-sm text-rose-700">{error}</Card>}
      {notice && <Card role="status" className="text-sm">{notice}</Card>}
    </>}
  </PageShell>;
}

function formatTime(value: number | null) {
  return value === null ? "Never" : new Date(value).toLocaleString();
}
