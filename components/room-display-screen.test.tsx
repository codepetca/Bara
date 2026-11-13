import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.fn();
let connected = true;
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => query(...args), useConvexConnectionState: () => ({ isWebSocketConnected: connected, connectionCount: 1 }) }));
vi.mock("@/convex/api", () => ({ api: { rooms: { display: "display" } } }));
import { RoomDisplayScreen } from "./room-display-screen";

describe("room display", () => {
  beforeEach(() => { connected = true; window.location.hash = "paired"; query.mockReturnValue({ label: "Room 220", proof: "proof", nextChangeAt: Date.now() + 60_000, notices: [] }); });
  it("shows the room QR while connected", () => {
    render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Scan to check in")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan to check in")).toBeInTheDocument();
  });
  it("hides the code when disconnected", () => {
    connected = false;
    render(<RoomDisplayScreen roomId="room" />);
    expect(screen.getByText("Check in with your teacher")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scan to check in")).not.toBeInTheDocument();
  });
});
