"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DisplayRoomEditor } from "@/components/display-room-editor";
import { PageShell } from "@/components/page-shell";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import {
  defaultDisplayName, displayPairingCodePattern, displayPlatformLabels, normalizeDisplayPairingCode, type DisplayPlatform,
} from "@/lib/display-pairing";

const field = "w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900";
type DisplayDetails = { deviceId: Id<"room_display_devices">; label: string; platform: DisplayPlatform };
type RoomOption = { roomId: Id<"rooms">; label: string; occupied: boolean };
type RoomChoice = { roomId: string; newRoomName: string | null };
const noRoom: RoomChoice = { roomId: "", newRoomName: null };
const editRooms = "edit-rooms";

function DisplayFields({ label, platform, onLabel, onPlatform, busy, required = true, placeholder }: {
  label: string;
  platform: DisplayPlatform;
  onLabel: (label: string) => void;
  onPlatform: (platform: DisplayPlatform) => void;
  busy: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  return <>
    <label className="block space-y-2 text-sm font-medium">Display type
      <select className={field} value={platform} onChange={(event) => onPlatform(event.target.value as DisplayPlatform)} disabled={busy}>
        {Object.entries(displayPlatformLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </label>
    <label className="block space-y-2 text-sm font-medium">Name or asset tag
      <input className={field} value={label} placeholder={placeholder} onChange={(event) => onLabel(event.target.value)}
        maxLength={80} required={required} disabled={busy} />
    </label>
  </>;
}

function DisplayEditor({ organizationId, device, onClose }: {
  organizationId: Id<"organizations">;
  device: DisplayDetails;
  onClose: (saved?: boolean) => void;
}) {
  const updateDisplay = useMutation(api.displayPairing.updateDisplay);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [label, setLabel] = useState(device.label);
  const [platform, setPlatform] = useState(device.platform);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = label.trim() && (label.trim() !== device.label || platform !== device.platform);

  useEffect(() => heading.current?.focus(), []);

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await updateDisplay({ organizationId, deviceId: device.deviceId, label: label.trim(), platform });
      onClose(true);
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Could not save the display.");
      setBusy(false);
    }
  }

  return <Dialog open labelledBy={titleId} onClose={() => onClose()} closeDisabled={busy}
    panelClassName="max-h-[85dvh] overflow-y-auto rounded-[28px]">
    <Card className="bg-white">
      <h2 id={titleId} ref={heading} tabIndex={-1} className="font-heading text-xl font-semibold">Edit display</h2>
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <DisplayFields label={label} platform={platform} onLabel={setLabel} onPlatform={setPlatform} busy={busy} />
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onClose()}>Cancel</Button>
          <Button type="submit" disabled={busy || !canSave}>{busy ? "Saving…" : "Save display"}</Button>
        </div>
      </form>
    </Card>
  </Dialog>;
}

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
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [platform, setPlatform] = useState<DisplayPlatform>("ipad");
  const [room, setRoom] = useState<RoomChoice>(noRoom);
  const [editor, setEditor] = useState<{
    kind: "rooms" | "display"; deviceId: Id<"room_display_devices">; trigger: HTMLElement;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalizedCode = normalizeDisplayPairingCode(code);
  const validCode = displayPairingCodePattern.test(normalizedCode);
  const suggestedLabel = validCode ? defaultDisplayName(platform, normalizedCode) : "";
  const availableRooms = fleet?.rooms.filter((room) => !room.occupied) ?? [];
  const canRegister = validCode && roomChoiceIsValid(room, availableRooms);
  const editedDisplay = editor?.kind === "display" ? fleet?.devices.find((device) => device.deviceId === editor.deviceId) : undefined;

  function closeEditor(saved?: boolean) {
    editor?.trigger.focus();
    setEditor(null);
    if (saved) setNotice("Display updated.");
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "";
      setError(message || fallback);
    } finally { setBusy(false); }
  }

  return <PageShell title={setup ? "Register display" : "Displays"} titleContainerClassName="pl-9 pr-24 sm:px-20">
    {bootstrapError ? <Card role="alert">{bootstrapError}</Card> : !isReady || options === undefined ? <Card>Loading displays…</Card> : organizations.length === 0 ? <Card>No organizations available to manage displays.</Card> : <>
      {organizations.length > 1 && <Card><label className="block space-y-2 text-sm font-medium">Organization<select className={field} value={organizationId} disabled={busy || editor !== null} onChange={(event) => { setChosenOrg(event.target.value); setRoom(noRoom); setError(null); }}>
        {organizations.map((org) => <option key={org.organizationId} value={org.organizationId}>{org.name}</option>)}
      </select></label></Card>}
      {fleet === undefined ? <Card>Loading displays…</Card> : setup ? <Card>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (busy || !organizationId || !canRegister) return; void run(async () => {
          const label = customLabel?.trim();
          const result = await register({ organizationId, code: normalizedCode, ...(label ? { label } : {}), platform, ...roomAssignment(room) });
          if (result.error) {
            throw new Error(result.error.toLowerCase().includes("attempt") ? result.error : "This code is invalid, expired, or already used. Get a new code on the display.");
          }
          router.push(`/displays?organizationId=${encodeURIComponent(organizationId)}`);
        }, "Could not register this display. Check the code and try again."); }}>
          <label className="block space-y-2 text-sm font-medium">Display code<input className={field} value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
          <DisplayFields label={customLabel ?? suggestedLabel} platform={platform} onLabel={setCustomLabel} onPlatform={setPlatform}
            busy={busy} required={false} placeholder={suggestedLabel} />
          <RoomField label="Room" emptyLabel="Register without room" rooms={availableRooms} choice={room} onChange={setRoom} busy={busy} />
          <Button type="submit" className="w-full" disabled={busy || !canRegister}>{busy ? "Registering…" : "Register display"}</Button>
          <p className="text-sm text-slate-600">Codes expire after a few minutes. If a code has expired or was already used, get a new one on the display.</p>
        </form>
      </Card> : <>
        <Link className={buttonVariants({ variant: "outline", className: "self-start" })} href="/displays/setup">Register a display</Link>
        {fleet.devices.length === 0 ? <Card>No displays registered yet.</Card> : fleet.devices.map((device) => {
          const rooms = fleet.rooms.filter((room) => !room.occupied || room.roomId === device.roomId);
          return <Card key={device.deviceId} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 break-words font-heading text-lg font-semibold">{device.label}</h2>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Edit ${device.label}`}
                onClick={(event) => {
                  setNotice(null);
                  setError(null);
                  setEditor({ kind: "display", deviceId: device.deviceId, trigger: event.currentTarget });
                }}>Edit</Button>
            </div>
            <label className="block space-y-1 text-sm font-medium">Room for {device.label}
              <select className={field} value={device.roomId ?? ""} disabled={busy} onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === editRooms) {
                  setEditor({ kind: "rooms", deviceId: device.deviceId, trigger: event.currentTarget });
                  return;
                }
                void run(async () => {
                  await assign({ organizationId: organizationId!, deviceId: device.deviceId, roomId: value ? value as Id<"rooms"> : null });
                  setNotice(`Updated ${device.label}.`);
                }, "Could not update this display.");
              }}>
                <option value={editRooms}>Edit rooms</option>
                <option value="">No room</option>
                {rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.label}</option>)}
              </select>
            </label>
          </Card>;
        })}
        {editor?.kind === "rooms" && organizationId && <DisplayRoomEditor organizationId={organizationId} deviceId={editor.deviceId} rooms={fleet.rooms}
          onClose={closeEditor} />}
        {editedDisplay && organizationId && <DisplayEditor organizationId={organizationId} device={editedDisplay} onClose={closeEditor} />}
      </>}
      {error && <Card role="alert" className="text-sm text-rose-700">{error}</Card>}
      {notice && <Card role="status" className="text-sm">{notice}</Card>}
    </>}
  </PageShell>;
}
