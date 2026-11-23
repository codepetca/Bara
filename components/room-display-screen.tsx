"use client";

import { ConvexHttpClient } from "convex/browser";
import { useConvex, useConvexConnectionState, useQuery } from "convex/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { Button } from "@/components/ui/button";
import { RegisteredDisplayCheckIn } from "@/components/registered-display-check-in";
import { useRoomDisplayUpdate } from "@/components/use-room-display-update";

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

function checkInIsClosed(display: Display | null | undefined) {
  return display?.nextChangeAt === null && display.proof === null;
}

function postNativeDisplayState(state: "closed" | "readable") {
  const nativeWindow = window as Window & {
    webkit?: { messageHandlers?: { baraDisplayState?: { postMessage: (message: string) => void } } };
  };
  nativeWindow.webkit?.messageHandlers?.baraDisplayState?.postMessage(state);
}

export function RoomDisplayScreen({ roomId, version, displayCredential, registeredDisplay, fixture }: {
  roomId: string;
  version?: string | null;
  displayCredential?: string;
  registeredDisplay?: { label: string; launchId: string };
  fixture?: { display: Display | null; connected: boolean };
}) {
  const location = useSyncExternalStore(subscribeLocation, locationSnapshot, serverLocationSnapshot);
  const hashAt = location.indexOf("#");
  const origin = hashAt < 0 ? location : location.slice(0, hashAt);
  const credential = displayCredential ?? (hashAt < 0 ? null : location.slice(hashAt + 1) || null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState(0);
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const online = useSyncExternalStore(subscribeNetwork, getOnline, getServerOnline);
  const queriedDisplay = useQuery(api.rooms.display, !fixture && credential && online ? { roomId: roomId as Id<"rooms">, credential, refresh: refresh + connection.connectionCount * 1_000_000 } : "skip");
  const connected = fixture ? fixture.connected : online && connection.isWebSocketConnected;
  const idle = !fixture && connected && Boolean(credential) && checkInIsClosed(queriedDisplay);
  useEffect(() => {
    postNativeDisplayState(idle ? "closed" : "readable");
  }, [idle]);
  useEffect(() => () => postNativeDisplayState("readable"), []);
  useRoomDisplayUpdate({
    version,
    idle,
    confirmIdle: async (signal) => {
      if (!credential || !convex.connectionState().isWebSocketConnected) return false;
      const client = new ConvexHttpClient(convex.url, {
        logger: false,
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal }),
      });
      const current = await client.query(api.rooms.display, {
        roomId: roomId as Id<"rooms">,
        credential,
      });
      return convex.connectionState().isWebSocketConnected && checkInIsClosed(current);
    },
    reload: () => window.location.reload(),
  });
  const pairing = connected && credential ? JSON.stringify([roomId, credential, connection.connectionCount]) : null;
  const [lastDisplay, setLastDisplay] = useState<{ pairing: string; display: Display } | null>(null);
  if (pairing && queriedDisplay) {
    if (lastDisplay?.pairing !== pairing || lastDisplay.display !== queriedDisplay) {
      setLastDisplay({ pairing, display: queriedDisplay });
    }
  } else if (lastDisplay && (lastDisplay.pairing !== pairing || queriedDisplay === null)) {
    setLastDisplay(null);
  }
  // Keep the room link visible while a cutoff refresh waits for the server.
  const previousDisplay = lastDisplay?.pairing === pairing ? lastDisplay?.display : null;
  const display = fixture ? fixture.display : queriedDisplay === undefined ? previousDisplay : queriedDisplay;
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
  const available = connected && display && origin;
  const roomPath = encodeURIComponent(roomId);
  const scanUrl = display?.pikaOrigin
    ? `${display.pikaOrigin}/attendance/room/${roomPath}/scan`
    : `${origin}/rooms/${roomPath}/scan`;
  const confirmed = fixture || queriedDisplay;
  const proof = confirmed && display && (!display.nextChangeAt || now < display.nextChangeAt) ? display.proof : null;
  const url = proof ? `${scanUrl}?proof=${encodeURIComponent(proof)}` : scanUrl;
  if (!available) {
    return (
      <main className="flex min-h-dvh flex-col p-6 sm:p-10">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-5xl">Room display</h1>
        <div className="flex flex-1 items-center justify-center text-center font-heading text-3xl font-semibold sm:text-5xl">Check in with your teacher</div>
      </main>
    );
  }

  const hasNotices = display.notices.length > 0;
  return (
    <main className={`grid min-h-dvh grid-cols-1 grid-rows-[1fr_auto_1fr] gap-y-1 p-4 sm:px-8 ${hasNotices ? "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-x-8" : ""}`}>
      <header className="col-span-full row-start-1 flex items-start justify-between gap-4">
        <h1 className="min-w-0 font-heading text-[clamp(2rem,7.5vmin,3.25rem)] leading-none font-semibold tracking-tight [overflow-wrap:anywhere]">{display.label}</h1>
        <h2 className="text-right font-heading text-[clamp(1.25rem,4.5vmin,2.5rem)] leading-tight font-semibold">
          {proof ? "Scan to check in" : "Check-in is closed"}
        </h2>
      </header>
      <div className="col-start-1 row-start-2 w-full max-w-[max(12rem,calc(100dvh-9rem))] place-self-center rounded-[28px] bg-white p-6 sm:p-8">
        <QRCode value={url} aria-label={proof ? "Scan to check in" : "Scan to move a class"} className="h-auto w-full" />
      </div>
      {hasNotices ? (
        <section className="col-start-1 row-start-3 flex flex-col items-center justify-center gap-6 text-center md:col-start-2 md:row-start-2" aria-live="polite">
          <p className="max-w-2xl whitespace-pre-wrap text-3xl leading-snug sm:text-5xl">{display.notices[notice % display.notices.length]}</p>
          {display.notices.length > 1 ? <Button variant="outline" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</Button> : null}
        </section>
      ) : null}
      <footer className={`col-span-full flex items-end justify-between gap-4 ${hasNotices ? "row-start-4 md:row-start-3" : "row-start-3"}`}>
        {registeredDisplay ? <p className="min-w-0 text-sm text-text-muted [overflow-wrap:anywhere]">{registeredDisplay.label}</p> : null}
        {!proof ? <p className="ml-auto text-right text-text-muted sm:text-lg">Teachers can scan to move a class.</p> : null}
      </footer>
      {registeredDisplay && credential ? (
        <RegisteredDisplayCheckIn credential={credential} launchId={registeredDisplay.launchId} roomId={roomId as Id<"rooms">} />
      ) : null}
    </main>
  );
}
