"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { Button } from "@/components/ui/button";

const subscribeLocation = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
const locationSnapshot = () => `${window.location.origin}${window.location.hash}`;
const serverLocationSnapshot = () => "";
const subscribeNetwork = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

type Display = { label: string; proof: string | null; nextChangeAt: number | null; notices: string[]; pikaOrigin?: string };

export function RoomDisplayScreen({ roomId, fixture }: { roomId: string; fixture?: { display: Display | null; connected: boolean } }) {
  const location = useSyncExternalStore(subscribeLocation, locationSnapshot, serverLocationSnapshot);
  const hashAt = location.indexOf("#");
  const origin = hashAt < 0 ? location : location.slice(0, hashAt);
  const credential = hashAt < 0 ? null : location.slice(hashAt + 1) || null;
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState(0);
  const connection = useConvexConnectionState();
  const online = useSyncExternalStore(subscribeNetwork, getOnline, getServerOnline);
  const queriedDisplay = useQuery(api.rooms.display, !fixture && credential && online ? { roomId: roomId as Id<"rooms">, credential, refresh: refresh + connection.connectionCount * 1_000_000 } : "skip");
  const display = fixture ? fixture.display : queriedDisplay;
  useEffect(() => {
    if (!display?.nextChangeAt) return;
    const timer = setTimeout(() => { setNow(Date.now()); setRefresh((n) => n + 1); }, Math.max(0, display.nextChangeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [display]);
  useEffect(() => {
    if (paused || !display || display.notices.length < 2) return;
    const timer = setInterval(() => setNotice((n) => n + 1), 10000);
    return () => clearInterval(timer);
  }, [paused, display]);
  const available = (fixture ? fixture.connected : online && connection.isWebSocketConnected) && display && (!display.nextChangeAt || now < display.nextChangeAt);
  const roomPath = encodeURIComponent(roomId);
  const scanUrl = display?.pikaOrigin
    ? `${display.pikaOrigin}/attendance/room/${roomPath}/scan`
    : origin && `${origin}/rooms/${roomPath}/scan`;
  const url = available && display.proof && scanUrl ? `${scanUrl}?proof=${encodeURIComponent(display.proof)}` : null;
  return (
    <main className="flex min-h-dvh flex-col p-6 sm:p-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-5xl">{available ? display.label : "Room display"}</h1>
      {!available ? <div className="flex flex-1 items-center justify-center text-center font-heading text-3xl font-semibold sm:text-5xl">Check in with your teacher</div> : (
        <div className={`grid flex-1 items-center gap-8 ${url && display.notices.length ? "md:grid-cols-2" : ""}`}>
          {url || !display.notices.length ? <section className="flex flex-col items-center gap-5 text-center">
            {url ? <><h2 className="font-heading text-3xl font-semibold sm:text-5xl">Scan to check in</h2><div className="w-full max-w-[min(70vh,32rem)] rounded-[28px] bg-white p-8"><QRCode value={url} aria-label="Scan to check in" className="h-auto w-full" /></div></> : <p className="font-heading text-3xl font-semibold">Check-in is closed</p>}
          </section> : null}
          {display.notices.length ? <section className="flex flex-col items-center gap-6 text-center" aria-live="polite">
            {display.notices.length ? <><p className="max-w-2xl whitespace-pre-wrap text-3xl leading-snug sm:text-5xl">{display.notices[notice % display.notices.length]}</p>{display.notices.length > 1 ? <Button variant="outline" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</Button> : null}</> : null}
          </section> : null}
        </div>
      )}
    </main>
  );
}
