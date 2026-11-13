import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import RoomsPage from "./page";

const create = vi.fn().mockResolvedValue("room-2");
const pair = vi.fn().mockResolvedValue("secret");
let canManage = true;
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), use: (value: unknown) => value }));
vi.mock("convex/react", () => ({
  useQuery: () => ({ supported: true, defaultRoomId: "room-1", rooms: [{ roomId: "room-1", label: "Room 223", notices: ["Welcome"], canManage }] }),
  useMutation: (ref: never) => getFunctionName(ref) === "rooms:create" ? create : getFunctionName(ref) === "rooms:pairDisplay" ? pair : vi.fn(),
}));
vi.mock("@/components/auth-header-controls", () => ({ AuthHeaderControls: () => null }));

describe("room settings", () => {
  it("hides display management from other staff", () => {
    canManage = false;
    render(<RoomsPage params={{ rosterId: "roster-1" } as never} />);
    expect(screen.queryByRole("button", { name: "Pair display" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Announcements")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy staff shortcut" })).toBeInTheDocument();
    canManage = true;
  });

  it("creates a room and presents a paired display link", async () => {
    render(<RoomsPage params={{ rosterId: "roster-1" } as never} />);
    expect(screen.getByLabelText("Staff shortcut for Room 223")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Room 220" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ rosterId: "roster-1", label: "Room 220" }));
    fireEvent.click(screen.getByRole("button", { name: "Pair display" }));
    expect(await screen.findByRole("link", { name: /\/rooms\/room-1\/display#secret/ })).toHaveAttribute("href", expect.stringContaining("/rooms/room-1/display#secret"));
    expect(pair).toHaveBeenCalledWith({ rosterId: "roster-1", roomId: "room-1" });
  });
});
