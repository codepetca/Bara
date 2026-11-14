import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import RoomsPage from "./page";

const create = vi.fn().mockResolvedValue("room-2");
const pair = vi.fn().mockResolvedValue("secret");
const pairByCode = vi.fn().mockResolvedValue("paired");
let canManage = true;
let shortCodePairing = true;
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), use: (value: unknown) => value }));
vi.mock("convex/react", () => ({
  useQuery: () => ({ supported: true, shortCodePairing, defaultRoomId: "room-1", rooms: [{ roomId: "room-1", label: "Room 223", notices: ["Welcome"], canManage, paired: true }] }),
  useMutation: (ref: never) => ({ "rooms:create": create, "rooms:pairDisplay": pair, "rooms:pairDisplayByCode": pairByCode }[getFunctionName(ref)] ?? vi.fn()),
}));
vi.mock("@/components/auth-header-controls", () => ({ AuthHeaderControls: () => null }));

describe("room settings", () => {
  it("hides display management from other staff", () => {
    canManage = false;
    render(<RoomsPage params={{ rosterId: "roster-1" } as never} />);
    expect(screen.queryByRole("button", { name: "Pair display" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Display pairing code")).not.toBeInTheDocument();
    expect(screen.queryByText("Set up tablet kiosk mode")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Announcements")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy staff shortcut" })).toBeInTheDocument();
    canManage = true;
  });

  it("creates a room and presents a paired display link", async () => {
    shortCodePairing = false;
    render(<RoomsPage params={{ rosterId: "roster-1" } as never} />);
    expect(screen.getByLabelText("Staff shortcut for Room 223")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Room 220" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ rosterId: "roster-1", label: "Room 220" }));
    expect(screen.getByText("Set up tablet kiosk mode")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create display pairing link" }));
    expect(await screen.findByRole("link", { name: /\/rooms\/room-1\/display#secret/ })).toHaveAttribute("href", expect.stringContaining("/rooms/room-1/display#secret"));
    expect(pair).toHaveBeenCalledWith({ rosterId: "roster-1", roomId: "room-1" });
    const setup = screen.getByText("Set up tablet kiosk mode");
    expect(setup.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(setup);
    expect(screen.getByRole("heading", { name: "iPad with Guided Access" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Android with a school-managed tablet" })).toBeVisible();
    shortCodePairing = true;
  });

  it("pairs a tablet with the code displayed by the receiver", async () => {
    render(<RoomsPage params={{ rosterId: "roster-1" } as never} />);
    expect(screen.getByText("Set up tablet kiosk mode")).toBeVisible();
    const submit = screen.getByRole("button", { name: "Pair display" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Display pairing code"), { target: { value: "abcd-2345" } });
    fireEvent.click(submit);
    expect(await screen.findByRole("status")).toHaveTextContent("Paired Room 223.");
    expect(pairByCode).toHaveBeenCalledWith({ rosterId: "roster-1", roomId: "room-1", code: "ABCD2345" });
  });
});
