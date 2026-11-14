import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
const query = vi.fn();
let connected = true;
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => query(...args), useConvexConnectionState: () => ({ isWebSocketConnected: connected, connectionCount: 1 }) }));
vi.mock("react-qr-code", () => ({
  default: ({ value, "aria-label": label }: { value: string; "aria-label": string }) => (
    <svg aria-label={label} data-scan-url={value} />
  ),
}));
vi.mock("@/convex/api", () => ({ api: { rooms: { display: "display" } } }));
import { RoomDisplayScreen } from "./room-display-screen";

describe("room display", () => {
  beforeEach(() => { connected = true; window.location.hash = "paired"; query.mockReturnValue({ label: "Room 220", proof: "proof", nextChangeAt: Date.now() + 60_000, notices: [] }); });
  it("shows the room QR while connected", () => {
    render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Scan to check in")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan to check in")).toHaveAttribute(
      "data-scan-url", `${window.location.origin}/rooms/room/scan?proof=proof`,
    );
  });
  it("replaces one closed Pika QR with a fresh live QR without changing the room", () => {
    const display = { label: "Room 220", nextChangeAt: null, notices: ["Welcome"], pikaOrigin: "https://pika.example" };
    query.mockReturnValue({ ...display, proof: null });
    const { rerender } = render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Check-in is closed")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan to move a class")).toHaveAttribute(
      "data-scan-url", "https://pika.example/attendance/room/room/scan",
    );
    expect(screen.queryByLabelText("Scan to check in")).not.toBeInTheDocument();

    query.mockReturnValue({ ...display, proof: "new-proof" });
    rerender(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByLabelText("Scan to check in")).toHaveAttribute(
      "data-scan-url", "https://pika.example/attendance/room/room/scan?proof=new-proof",
    );
    expect(screen.queryByLabelText("Scan to move a class")).not.toBeInTheDocument();
  });
  it("shows only a room link after the visible proof reaches its cutoff", () => {
    vi.useFakeTimers();
    try {
      const live = { label: "Room 220", proof: "stale", nextChangeAt: Date.now() + 1000, notices: ["Welcome"] };
      query.mockImplementation((_function, args) => args.refresh === 1_000_000 ? live : undefined);
      const { rerender } = render(<RoomDisplayScreen roomId="room" />);
      expect(screen.getByLabelText("Scan to check in")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByLabelText("Scan to move a class")).toHaveAttribute(
        "data-scan-url", `${window.location.origin}/rooms/room/scan`,
      );
      expect(screen.queryByLabelText("Scan to check in")).not.toBeInTheDocument();
      expect(screen.getByText("Welcome")).toBeInTheDocument();

      query.mockReturnValue(null);
      rerender(<RoomDisplayScreen roomId="room" />);
      expect(screen.queryByLabelText("Scan to move a class")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("hides the code when pairing is unavailable", () => {
    query.mockReturnValue(null);
    render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Check in with your teacher")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scan to move a class")).not.toBeInTheDocument();
  });
  it("hides the code when disconnected", () => {
    connected = false;
    render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Check in with your teacher")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scan to check in")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Scan to move a class")).not.toBeInTheDocument();
  });
});

describe("room display wake lock", () => {
  const wakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  let visibility: MockInstance<() => DocumentVisibilityState>;

  beforeEach(() => {
    connected = true;
    window.location.hash = "paired";
    visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    query.mockReturnValue({ label: "Room 220", proof: null, nextChangeAt: null, notices: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (wakeLockDescriptor) {
      Object.defineProperty(navigator, "wakeLock", wakeLockDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
  });

  function mockWakeLock() {
    const lock = { released: false, release: vi.fn().mockResolvedValue(undefined) };
    const request = vi.fn().mockResolvedValue(lock);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    return { lock, request };
  }

  it("keeps the closed QR awake and reacquires the lock after returning to the page", async () => {
    const { lock, request } = mockWakeLock();
    const { rerender } = render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByLabelText("Scan to move a class")).toBeInTheDocument();
    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
    await act(async () => {});

    query.mockReturnValue({ label: "Room 220", proof: "new-proof", nextChangeAt: null, notices: [] });
    rerender(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByLabelText("Scan to check in")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(request).toHaveBeenCalledTimes(2);

    connected = false;
    rerender(<RoomDisplayScreen roomId="room" />);
    expect(lock.release).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Check in with your teacher")).toBeInTheDocument();
  });

  it("releases a lock granted after the display unmounts", async () => {
    const { lock } = mockWakeLock();
    const { unmount } = render(<RoomDisplayScreen roomId="room" />);
    unmount();
    await act(async () => {});
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("retries when a request fails after the display has returned to the foreground", async () => {
    const { request } = mockWakeLock();
    let rejectRequest!: (reason: DOMException) => void;
    request.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    render(<RoomDisplayScreen roomId="room" />);

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => rejectRequest(new DOMException("Page was hidden", "NotAllowedError")));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the QR visible if the browser denies the wake lock", async () => {
    const { request } = mockWakeLock();
    request.mockRejectedValueOnce(new DOMException("Wake lock denied", "NotAllowedError"));
    render(<RoomDisplayScreen roomId="room" />);
    await act(async () => {});
    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
    expect(screen.getByLabelText("Scan to move a class")).toBeInTheDocument();
  });
});
