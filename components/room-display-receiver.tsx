"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/api";
import { displayCredentialPattern, displayPairingBeginPath } from "@/lib/display-pairing";
import { sha256Hex } from "@/lib/attendance-contract/v1/signing";
import { createShareToken } from "@/lib/session-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RoomDisplayScreen } from "@/components/room-display-screen";

const storageKey = "bara-room-display-credential";
const storageEvent = "bara-display-credential-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(storageEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(storageEvent, onChange);
  };
}

function storedCredential() {
  try {
    const value = localStorage.getItem(storageKey) ?? "";
    return displayCredentialPattern.test(value) ? value : "";
  } catch {
    return "";
  }
}

const serverCredential = () => null;

export function RoomDisplayReceiver() {
  const credential = useSyncExternalStore(subscribe, storedCredential, serverCredential);
  const status = useQuery(api.displayPairing.status, credential ? { credential } : "skip");
  const connection = useConvexConnectionState();
  const started = useRef(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestCode = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      setError("");
      setBusy(true);
      const next = createShareToken(40);
      const credentialHash = await sha256Hex(next);
      localStorage.setItem(storageKey, next);
      window.dispatchEvent(new Event(storageEvent));
      const response = await fetch(displayPairingBeginPath, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: credentialHash,
        signal: controller.signal,
      });
      if (response.status === 429) setError("Too many codes were requested on this network. Try again in a few minutes.");
      else if (!response.ok) throw new Error("Couldn’t get a pairing code.");
    } catch {
      setError("Couldn’t get a pairing code. Check this display’s connection and try again.");
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (credential !== "" || started.current) return;
    started.current = true;
    void requestCode();
  }, [credential, requestCode]);

  if (status?.state === "paired" && credential) {
    return <RoomDisplayScreen key={status.roomId} roomId={status.roomId} displayCredential={credential} />;
  }

  const waiting = status?.state === "waiting" && connection.isWebSocketConnected;
  const loading = !error && (busy || credential === null || credential === "" || !connection.isWebSocketConnected || status === undefined);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-8">
      <Card className="w-full max-w-xl space-y-6 p-8 text-center sm:p-12" aria-labelledby="pair-display-title">
        <h1 id="pair-display-title" className="font-heading text-3xl font-semibold sm:text-4xl">Pair this display</h1>
        {waiting ? (
          <>
            <p className="text-base text-text-muted sm:text-lg">Choose a room in Pika’s Attendance rooms or Bara’s Rooms, then enter this code.</p>
            <p
              aria-label={`Pairing code ${status.code.split("").join(" ")}`}
              className="font-mono text-[clamp(1.75rem,7vw,3.5rem)] font-semibold tracking-widest"
              role="status"
            >
              {status.code.slice(0, 4)}-{status.code.slice(4)}
            </p>
            <p className="text-sm text-text-muted">The code expires in 5 minutes.</p>
          </>
        ) : loading ? (
          <p role="status" className="text-text-muted">
            {credential && !connection.isWebSocketConnected ? "Waiting for a connection…" : "Getting the display ready…"}
          </p>
        ) : (
          <>
            {error ? <p role="alert">{error}</p> : <p className="text-text-muted">This display needs a new pairing code.</p>}
            <Button onClick={() => void requestCode()} disabled={busy}>
              {error ? "Try again" : "Get a new code"}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
