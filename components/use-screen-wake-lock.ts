import { useEffect } from "react";

export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    const wakeLock = navigator.wakeLock;
    if (!enabled || !wakeLock) return;

    let lock: WakeLockSentinel | undefined;
    let requesting = false;
    let disposed = false;

    function releaseLock() {
      if (lock && !lock.released) void lock.release().catch(() => {});
      lock = undefined;
    }

    async function keepScreenAwake() {
      if (document.visibilityState !== "visible") {
        releaseLock();
        return;
      }
      if (requesting || (lock && !lock.released)) return;

      requesting = true;
      try {
        lock = await wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") releaseLock();
      } catch {
        // Device policy or power settings can deny a lock. Keep displaying the QR.
      } finally {
        requesting = false;
      }
    }

    document.addEventListener("visibilitychange", keepScreenAwake);
    void keepScreenAwake();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", keepScreenAwake);
      releaseLock();
    };
  }, [enabled]);
}
