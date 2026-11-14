import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomDate } from "@/lib/room-date";

const redeem = vi.fn();
const mutation = vi.fn();
vi.mock("@/app/rooms/[roomId]/check-in/actions", () => ({ redeemRoomScan: (...args: unknown[]) => redeem(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("convex/react", () => ({ useMutation: () => mutation }));
vi.mock("@/convex/api", () => ({ api: { rooms: { moveMeeting: {}, undoMove: {}, setDefault: {} } } }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import { RoomCheckInScreen } from "./room-check-in-screen";

const context = { label: "Room 220", get date() { return roomDate(Date.now()); }, role: "both" as const, canCheckIn: true, meetings: [], rosters: [] };
describe("room check-in", () => {
  beforeEach(() => { redeem.mockReset(); redeem.mockResolvedValue({ status: "complete", results: [{ name: "Class A", code: "present_marked" }] }); });
  it("requires an explicit student choice for an account with both roles", async () => {
    render(<RoomCheckInScreen roomId="room" scanId="scan-a" context={context} staffOnly={false} />);
    expect(redeem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check in as student" }));
    await waitFor(() => expect(redeem).toHaveBeenCalledWith("room", "scan-a", true));
    expect(await screen.findByText("Class A: Checked in")).toBeInTheDocument();
  });
  it("does not offer room controls to a student using a staff sticker", () => {
    render(<RoomCheckInScreen roomId="room" scanId="scan-a" context={{ ...context, role: "student" }} staffOnly />);
    expect(screen.getByText("Check in with your teacher.")).toBeInTheDocument();
    expect(screen.queryByText("Manage room")).not.toBeInTheDocument();
    expect(redeem).not.toHaveBeenCalled();
  });
  it("shows a closed message to a student without submitting attendance", () => {
    render(<RoomCheckInScreen roomId="room" scanId={null} context={{ ...context, role: "student", canCheckIn: false }} staffOnly closedScan />);
    expect(screen.getByText("Check-in is closed. Scan the room QR again when check-in opens.")).toBeInTheDocument();
    expect(redeem).not.toHaveBeenCalled();
  });
  it("opens one-meeting move controls from the closed-room code", async () => {
    mutation.mockResolvedValue(1);
    render(<RoomCheckInScreen roomId="room" scanId={null} context={{
      ...context, role: "staff", canCheckIn: false,
      meetings: [{ name: "P5", rosterId: "p5" as never, sessionId: "meeting" as never }],
    }} staffOnly closedScan />);
    fireEvent.click(screen.getByRole("button", { name: "Move P5 here" }));
    expect(await screen.findByText("Moved P5 here")).toBeInTheDocument();
    expect(mutation).toHaveBeenCalledExactlyOnceWith({ roomId: "room", sessionId: "meeting" });
    expect(redeem).not.toHaveBeenCalled();
  });
  it("never checks in from a staff sticker", () => {
    render(<RoomCheckInScreen roomId="room" scanId="scan-a" context={context} staffOnly />);
    expect(screen.getByText("No classes are available to manage.")).toBeInTheDocument();
    expect(redeem).not.toHaveBeenCalled();
  });
});
