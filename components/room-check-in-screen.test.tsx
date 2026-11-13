import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redeem = vi.fn();
const mutation = vi.fn();
vi.mock("@/app/rooms/[roomId]/check-in/actions", () => ({ redeemRoomScan: (...args: unknown[]) => redeem(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("convex/react", () => ({ useMutation: () => mutation }));
vi.mock("@/convex/api", () => ({ api: { rooms: { moveMeeting: {}, undoMove: {}, setDefault: {} } } }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import { RoomCheckInScreen } from "./room-check-in-screen";

const context = { label: "Room 220", date: "2026-11-13", role: "both" as const, canCheckIn: true, meetings: [], rosters: [] };
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
  it("never checks in from a staff sticker", () => {
    render(<RoomCheckInScreen roomId="room" scanId="scan-a" context={context} staffOnly />);
    expect(screen.getByText("No classes are available to manage.")).toBeInTheDocument();
    expect(redeem).not.toHaveBeenCalled();
  });
});
