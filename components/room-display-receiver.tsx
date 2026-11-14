"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/api";
import { displayCredentialPattern } from "@/lib/display-pairing";
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
  const begin = useMutation(api.displayPairing.begin);
  const started = useRef(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expiresAt = status?.state === "waiting" ? status.expiresAt : null;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  const requestCode = useCallback(async (reuse?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = reuse || createShareToken(40);
      const credentialHash = await sha256Hex(next);
      setError("");
      setBusy(true);
      localStorage.setItem(storageKey, next);
      window.dispatchEvent(new Event(storageEvent));
      await begin({ credentialHash });
    } catch {
      setError("Couldn’t get a pairing code. Check this display’s connection and try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [begin]);

  useEffect(() => {
    if (credential !== "" || started.current) return;
    started.current = true;
    void requestCode();
  }, [credential, requestCode]);

  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setTimeout(() => setExpiredAt(expiresAt), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (status?.state === "paired" && credential) {
    return <RoomDisplayScreen key={status.roomId} roomId={status.roomId} displayCredential={credential} />;
  }

  const waiting = status?.state === "waiting" && expiresAt !== expiredAt;
  const loading = !error && (busy || credential === null || credential === "" || status === undefined);

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
          <p role="status" className="text-text-muted">Getting the display ready…</p>
        ) : (
          <>
            {error ? <p role="alert">{error}</p> : <p className="text-text-muted">{status?.state === "waiting" ? "The pairing code expired." : "This display needs a new pairing code."}</p>}
            <Button onClick={() => void requestCode(error && credential ? credential : undefined)} disabled={busy}>
              {error ? "Try again" : "Get a new code"}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
