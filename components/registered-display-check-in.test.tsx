import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Id } from "@/convex/model";
import { RegisteredDisplayCheckIn } from "./registered-display-check-in";

const report = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => report }));

afterEach(() => vi.useRealTimers());

it("reports each launch immediately and waits 15 minutes for the next heartbeat", async () => {
  vi.useFakeTimers();
  report.mockResolvedValue(null);
  const roomId = "room" as Id<"rooms">;
  const credential = "F".repeat(40);
  const { rerender } = render(<RegisteredDisplayCheckIn credential={credential} roomId={roomId} launchId="first" />);
  expect(report).toHaveBeenCalledExactlyOnceWith({ credential, roomId, launchId: "first" });
  await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
  expect(report).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(report).toHaveBeenCalledTimes(2);

  rerender(<RegisteredDisplayCheckIn credential={credential} roomId={roomId} launchId="reopened" />);
  expect(report).toHaveBeenCalledTimes(3);
  expect(report).toHaveBeenLastCalledWith({ credential, roomId, launchId: "reopened" });
});
