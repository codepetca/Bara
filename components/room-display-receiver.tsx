"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { api } from "@/convex/api";
import { displayCredentialPattern, displayPairingBeginPath } from "@/lib/display-pairing";
import { sha256Hex } from "@/lib/attendance-contract/v1/signing";
import { createShareToken } from "@/lib/session-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RoomDisplayScreen } from "@/components/room-display-screen";
import { RegisteredDisplayCheckIn } from "@/components/registered-display-check-in";

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
  const [expiredCode, setExpiredCode] = useState("");
  const [launchId] = useState(() => crypto.randomUUID());
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

  const code = status?.state === "waiting" ? status.code : null;
  const expiresAt = status?.state === "waiting" ? status.expiresAt : null;
  useEffect(() => {
    if (!code || expiresAt === null) return;
    const timer = setTimeout(() => setExpiredCode(code), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [code, expiresAt]);

  if (status?.state === "paired" && credential) {
    return <RoomDisplayScreen key={status.roomId} roomId={status.roomId} displayCredential={credential}
      registeredDisplay={status.deviceLabel ? { label: status.deviceLabel, launchId } : undefined} />;
  }

  if (status?.state === "registered" && credential) {
    return (
      <main className="grid min-h-dvh place-items-center px-5">
        <Card className="w-full max-w-xl space-y-3 p-8 text-center sm:p-12">
          <h1 className="font-heading text-3xl font-semibold sm:text-4xl">Waiting for room assignment</h1>
          <p className="text-lg text-text-muted">{status.deviceLabel}</p>
          {connection.isWebSocketConnected
            ? <RegisteredDisplayCheckIn credential={credential} launchId={launchId} roomId={null} />
            : <p role="status" className="text-text-muted">Waiting for a connection…</p>}
        </Card>
      </main>
    );
  }

  const waiting = code && code !== expiredCode && connection.isWebSocketConnected;
  const loading = !error && (busy || credential === null || credential === "" || !connection.isWebSocketConnected || status === undefined);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-8">
      <Card className="w-full max-w-xl space-y-6 p-8 text-center sm:p-12" aria-labelledby="pair-display-title">
        <h1 id="pair-display-title" className="font-heading text-3xl font-semibold sm:text-4xl">Set up this display</h1>
        {waiting ? (
          <>
            <p className="text-base text-text-muted sm:text-lg">Scan with a phone to register in Bara.</p>
            <div className="mx-auto w-full max-w-56 rounded-3xl border-4 border-indigo-500 bg-white p-5">
              <QRCode
                value={new URL(`/displays/setup?code=${code}`, window.location.origin).href}
                aria-label="Display setup QR"
                className="h-auto w-full"
              />
            </div>
            <p
              aria-label={`Pairing code ${code.split("").join(" ")}`}
              className="font-mono text-[clamp(1.75rem,7vw,3.5rem)] font-semibold tracking-widest"
              role="status"
            >
              {code.slice(0, 4)}-{code.slice(4)}
            </p>
            <p className="text-sm text-text-muted">Or enter the code in Bara’s Rooms or Pika’s Attendance rooms. It expires in 5 minutes.</p>
          </>
        ) : loading ? (
          <p role="status" className="text-text-muted">
            {credential && !connection.isWebSocketConnected ? "Waiting for a connection…" : "Getting the display ready…"}
          </p>
        ) : (
          <>
            {error ? <p role="alert">{error}</p> : <p className="text-text-muted">{code ? "The setup code expired." : "This display needs a new pairing code."}</p>}
            <Button onClick={() => void requestCode()} disabled={busy}>
              {error ? "Try again" : "Get a new code"}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
