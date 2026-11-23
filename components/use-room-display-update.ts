"use client";

import { useEffect, useEffectEvent } from "react";

const checkInterval = 15 * 60_000;
const checkTimeout = 10_000;
const reloadCooldown = 30 * 60_000;
const attemptKey = "bara-room-display-update";

export function useRoomDisplayUpdate({ version, idle, confirmIdle, reload }: {
  version?: string | null;
  idle: boolean;
  confirmIdle: (signal: AbortSignal) => Promise<boolean>;
  reload: () => void;
}) {
  const verifyIdle = useEffectEvent(confirmIdle);
  const reloadIfIdle = useEffectEvent((checkedVersion: string, pair: string) => {
    if (version !== checkedVersion || !idle || !navigator.onLine) return;
    // Record the attempt before leaving in case Safari gets the old page again.
    sessionStorage.setItem(attemptKey, JSON.stringify({ pair, at: Date.now() }));
    reload();
  });

  useEffect(() => {
    if (!version || !idle) return;
    const loadedVersion = version;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight: AbortController | undefined;

    async function checkVersion() {
      const request = new AbortController();
      inFlight = request;
      const timeout = setTimeout(() => request.abort(), checkTimeout);
      try {
        const response = await fetch("/api/display/version", {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: request.signal,
        });
        if (!response.ok) return;
        const { version: latest } = await response.json() as { version?: unknown };
        if (typeof latest !== "string" || !latest || latest === loadedVersion || request.signal.aborted) return;
        const pair = JSON.stringify([loadedVersion, latest]);
        const attempt: { pair?: string; at?: number } = JSON.parse(sessionStorage.getItem(attemptKey) ?? "{}");
        if (attempt.pair === pair && typeof attempt.at === "number" && Date.now() - attempt.at < reloadCooldown) return;
        // The version request may have taken long enough for a teacher to reopen check-in.
        if (await verifyIdle(request.signal) && !request.signal.aborted) reloadIfIdle(loadedVersion, pair);
      } catch {
        // Leave the display running if the network or local storage is unavailable.
      } finally {
        clearTimeout(timeout);
        inFlight = undefined;
        if (!stopped) timer = setTimeout(checkVersion, checkInterval);
      }
    }

    timer = setTimeout(checkVersion, checkInterval);
    return () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
    };
  }, [idle, version]);
}
