"use client";

import { useMutation, useQuery } from "convex/react";
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
  const [roomId, setRoomId] = useState("");
  const [draftRooms, setDraftRooms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalizedCode = normalizeDisplayPairingCode(code);
  const availableRooms = fleet?.rooms.filter((room) => !room.occupied) ?? [];
  const selectedRoomAvailable = !roomId || availableRooms.some((room) => room.roomId === roomId);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message || fallback);
    } finally { setBusy(false); }
  }

  return <PageShell title={setup ? "Register display" : "Displays"}>
    {bootstrapError ? <Card role="alert">{bootstrapError}</Card> : !isReady || options === undefined ? <Card>Loading displays…</Card> : organizations.length === 0 ? <Card>No organizations available to manage displays.</Card> : <>
      {organizations.length > 1 && <Card><label className="block space-y-2 text-sm font-medium">Organization<select className={field} value={organizationId} onChange={(event) => { setChosenOrg(event.target.value); setRoomId(""); setDraftRooms({}); setError(null); }}>
        {organizations.map((org) => <option key={org.organizationId} value={org.organizationId}>{org.name}</option>)}
      </select></label></Card>}
      {fleet === undefined ? <Card>Loading displays…</Card> : setup ? <Card>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!organizationId || !selectedRoomAvailable) return; void run(async () => {
          const result = await register({ organizationId, code: normalizedCode, label: label.trim(), platform, roomId: roomId ? roomId as Id<"rooms"> : null });
          if (result.error) {
            throw new Error(result.error.toLowerCase().includes("attempt") ? result.error : "This code is invalid, expired, or already used. Get a new code on the display.");
          }
          router.push(`/displays?organizationId=${encodeURIComponent(organizationId)}`);
        }, "Could not register this display. Check the code and try again."); }}>
          <label className="block space-y-2 text-sm font-medium">Display code<input className={field} value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
          <label className="block space-y-2 text-sm font-medium">Name or asset tag<input className={field} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required /></label>
          <label className="block space-y-2 text-sm font-medium">Display type<select className={field} value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}><option value="ipad">iPad</option><option value="android">Android</option><option value="other">Other</option></select></label>
          <label className="block space-y-2 text-sm font-medium">Room<select className={field} value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Register without room</option>{!selectedRoomAvailable && <option value={roomId} disabled>Room no longer available</option>}{availableRooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.label}</option>)}</select></label>
          {!availableRooms.length && <p className="text-sm text-slate-600">No rooms available. You can assign one later.</p>}
          {!selectedRoomAvailable && <p role="alert" className="text-sm text-rose-700">That room is no longer available. Choose another room or register without one.</p>}
          <Button type="submit" className="w-full" disabled={busy || !label.trim() || !displayPairingCodePattern.test(normalizedCode) || !selectedRoomAvailable}>{busy ? "Registering…" : "Register display"}</Button>
          <p className="text-sm text-slate-600">Codes expire after a few minutes. If a code has expired or was already used, get a new one on the display.</p>
        </form>
      </Card> : <>
        <Card className="space-y-3"><h2 className="font-heading text-lg font-semibold">Register a display</h2><p className="text-sm text-slate-600">Open Bara on the display, then scan its code or enter it here.</p><Link className={buttonVariants({ variant: "outline" })} href="/displays/setup">Enter a code</Link></Card>
        {fleet.devices.length === 0 ? <Card>No displays registered yet.</Card> : fleet.devices.map((device) => {
          const draft = draftRooms[device.deviceId] ?? device.roomId ?? "";
          const allowed = !draft || draft === device.roomId || availableRooms.some((room) => room.roomId === draft);
          return <Card key={device.deviceId} className="space-y-3">
            <div><h2 className="font-heading text-lg font-semibold">{device.label}</h2><p className="text-sm text-slate-600">{device.platform === "ipad" ? "iPad" : device.platform === "android" ? "Android" : "Other"}</p></div>
            <p className="text-sm text-slate-600">Last seen: {formatTime(device.lastSeenAt)} · Launch reported: {formatTime(device.openedAt)}</p>
            <label className="block space-y-2 text-sm font-medium">Room for {device.label}<select className={field} value={draft} onChange={(event) => setDraftRooms((current) => ({ ...current, [device.deviceId]: event.target.value }))}><option value="">No room</option>{!allowed && <option value={draft} disabled>Room no longer available</option>}{fleet.rooms.filter((room) => !room.occupied || room.roomId === device.roomId).map((room) => <option key={room.roomId} value={room.roomId}>{room.label}</option>)}</select></label>
            {!allowed && <p role="alert" className="text-sm text-rose-700">That room is no longer available. Choose another room.</p>}
            <Button variant="outline" disabled={busy || !allowed || draft === (device.roomId ?? "")} onClick={() => void run(async () => {
              await assign({ organizationId: organizationId!, deviceId: device.deviceId, roomId: draft ? draft as Id<"rooms"> : null });
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
