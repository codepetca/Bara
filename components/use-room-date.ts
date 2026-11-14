"use client";

import { useSyncExternalStore } from "react";
import { nextRoomDay, roomDate } from "@/lib/room-date";

function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  function refresh() {
    clearTimeout(timer);
    const now = Date.now();
    timer = setTimeout(refresh, Math.max(1, nextRoomDay(now) - now));
    onChange();
  }
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

const getDate = () => roomDate(Date.now());
const getServerDate = () => "";

export function useRoomDate() {
  return useSyncExternalStore(subscribe, getDate, getServerDate);
}
