"use client";

import { useSyncExternalStore } from "react";

function subscribeToOriginChanges() {
  return () => {};
}

function getBrowserOrigin() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function getServerOrigin() {
  return "";
}

export function useAppOrigin(configuredOrigin: string | null) {
  const browserOrigin = useSyncExternalStore(
    subscribeToOriginChanges,
    getBrowserOrigin,
    getServerOrigin,
  );

  return configuredOrigin ?? browserOrigin;
}
