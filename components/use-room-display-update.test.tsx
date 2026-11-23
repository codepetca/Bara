import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomDisplayUpdate } from "./use-room-display-update";

const interval = 15 * 60_000;
const version = "build-a";
const latest = "build-b";
const fetchVersion = vi.fn<typeof fetch>();
const confirmIdle = vi.fn<(signal: AbortSignal) => Promise<boolean>>();
const reload = vi.fn();

function useUpdate(idle: boolean) {
  useRoomDisplayUpdate({ version, idle, confirmIdle, reload });
}

describe("room display updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    fetchVersion.mockReset().mockImplementation(async () => Response.json({ version: latest }));
    confirmIdle.mockReset().mockResolvedValue(true);
    reload.mockReset();
    vi.stubGlobal("fetch", fetchVersion);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits 15 minutes after check-in closes before checking for updates", async () => {
    const { rerender } = renderHook(useUpdate, { initialProps: false });
    await vi.advanceTimersByTimeAsync(2 * interval);
    expect(fetchVersion).not.toHaveBeenCalled();

    rerender(true);
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(fetchVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchVersion).toHaveBeenCalledWith("/api/display/version", expect.objectContaining({
      cache: "no-store",
      credentials: "omit",
    }));
    expect(confirmIdle).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps running through failed checks and an unchanged deployment", async () => {
    fetchVersion
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(Response.json({ version }));
    renderHook(useUpdate, { initialProps: true });
    await vi.advanceTimersByTimeAsync(2 * interval);
    expect(fetchVersion).toHaveBeenCalledTimes(2);
    expect(confirmIdle).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("skips the reload if the fresh room query finds an open check-in", async () => {
    confirmIdle.mockResolvedValueOnce(false);
    renderHook(useUpdate, { initialProps: true });
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("abandons a check in flight when attendance reopens", async () => {
    let finishConfirmation!: (closed: boolean) => void;
    confirmIdle.mockReturnValueOnce(new Promise((resolve) => { finishConfirmation = resolve; }));
    const { rerender } = renderHook(useUpdate, { initialProps: true });
    await vi.advanceTimersByTimeAsync(interval);

    rerender(false);
    expect(confirmIdle.mock.calls[0][0].aborted).toBe(true);
    finishConfirmation(true);
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).not.toHaveBeenCalled();
    expect(fetchVersion).toHaveBeenCalledOnce();
  });

  it("retries a failed reload only after the cooldown for that version", async () => {
    const first = renderHook(useUpdate, { initialProps: true });
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).toHaveBeenCalledOnce();
    first.unmount();

    renderHook(useUpdate, { initialProps: true });
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(interval);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
