import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
