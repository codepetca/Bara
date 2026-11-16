import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayAdmin } from "./display-admin";

const register = vi.fn();
const assign = vi.fn();
const updateDisplay = vi.fn();
const addRoom = vi.fn();
const renameRoom = vi.fn();
const removeRoom = vi.fn();
const push = vi.fn();
const fleet = { rooms: [{ roomId: "room-1", label: "Room 1", occupied: false }, { roomId: "room-2", label: "Room 2", occupied: true }], devices: [{ deviceId: "device-1", label: "Tablet A", platform: "ipad", roomId: null, lastSeenAt: null, openedAt: null as number | null }] };
let queriedFleet = fleet;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth-header-controls", () => ({ AuthHeaderControls: () => null }));
vi.mock("@/components/use-current-app-user", () => ({ useCurrentAppUser: () => ({ isReady: true }) }));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => getFunctionName(ref) === "displayPairing:adminOptions" ? { organizations: [{ organizationId: "org-1", name: "School" }] } : queriedFleet,
  useMutation: (ref: never) => ({
    "displayPairing:register": register,
    "displayPairing:assign": assign,
    "displayPairing:updateDisplay": updateDisplay,
    "displayPairing:addRoom": addRoom,
    "displayPairing:renameRoom": renameRoom,
    "displayPairing:removeRoom": removeRoom,
  })[getFunctionName(ref)],
}));

beforeEach(() => {
  vi.clearAllMocks();
  queriedFleet = fleet;
  register.mockResolvedValue({ deviceId: "device-1" });
  assign.mockResolvedValue(null);
  updateDisplay.mockResolvedValue(null);
});

describe("display administration", () => {
  it("registers a display without a room and returns to its organization", async () => {
    render(<DisplayAdmin setup initialCode="abcd-2345" />);
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Room 2" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name or asset tag"), { target: { value: "Tablet A" } });
    fireEvent.change(screen.getByLabelText("Display type"), { target: { value: "android" } });
    fireEvent.click(screen.getByRole("button", { name: "Register display" }));
    await waitFor(() => expect(register).toHaveBeenCalledWith({ organizationId: "org-1", code: "ABCD2345", label: "Tablet A", platform: "android", roomId: null }));
    expect(push).toHaveBeenCalledWith("/displays?organizationId=org-1");
  });

  it("explains an expired or used code", async () => {
    register.mockResolvedValue({ error: "pairing_code_invalid" });
    render(<DisplayAdmin setup initialCode="ABCD2345" />);
    fireEvent.change(screen.getByLabelText("Name or asset tag"), { target: { value: "Tablet A" } });
    fireEvent.click(screen.getByRole("button", { name: "Register display" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expired, or already used");
    expect(push).not.toHaveBeenCalled();
  });

  it("adds the first room from tablet registration and keeps the QR code prefilled", async () => {
    queriedFleet = { rooms: [], devices: [] };
    render(<DisplayAdmin setup initialCode="abcd-2345" />);
    fireEvent.change(screen.getByLabelText("Name or asset tag"), { target: { value: "Tablet A" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    const submit = screen.getByRole("button", { name: "Register display" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Display code")).toHaveValue("abcd-2345");
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: " Room 223 " } });
    fireEvent.click(submit);
    await waitFor(() => expect(register).toHaveBeenCalledWith({
      organizationId: "org-1", code: "ABCD2345", label: "Tablet A", platform: "ipad", roomId: null, newRoomName: "Room 223",
    }));
    expect(push).toHaveBeenCalledWith("/displays?organizationId=org-1");
  });

  it("keeps room input after a conflict and lets the admin return to an existing room", async () => {
    register.mockRejectedValueOnce(new ConvexError("This room already has a display."));
    render(<DisplayAdmin setup initialCode="ABCD2345" />);
    fireEvent.change(screen.getByLabelText("Name or asset tag"), { target: { value: "Tablet A" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "room-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a room" }));
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Room 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Register display" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This room already has a display.");
    expect(screen.getByLabelText("Room name")).toHaveValue("Room 2");
    fireEvent.click(screen.getByRole("button", { name: "Cancel new room" }));
    expect(screen.getByLabelText("Room")).toHaveValue("room-1");
  });

  it("assigns a registered display to an available room", async () => {
    render(<DisplayAdmin />);
    fireEvent.change(screen.getByLabelText("Room for Tablet A"), { target: { value: "room-1" } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ organizationId: "org-1", deviceId: "device-1", roomId: "room-1" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Updated Tablet A");
  });

  it("offers Edit rooms first and adds a room from the dialog", async () => {
    queriedFleet = { ...fleet, rooms: [] };
    render(<DisplayAdmin />);
    const select = screen.getByLabelText("Room for Tablet A");
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Edit rooms");
    fireEvent.change(select, { target: { value: "edit-rooms" } });
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    expect(dialog.getByRole("button", { name: "Add room" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Room name"), { target: { value: "Room 223" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add room" }));
    await waitFor(() => expect(addRoom).toHaveBeenCalledWith({
      organizationId: "org-1", deviceId: "device-1", name: "Room 223",
    }));
    expect(await dialog.findByRole("status")).toHaveTextContent("Room added");
    expect(assign).not.toHaveBeenCalled();
  });

  it("renames a room and confirms removal inside the editor", async () => {
    render(<DisplayAdmin />);
    fireEvent.change(screen.getByLabelText("Room for Tablet A"), { target: { value: "edit-rooms" } });
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    fireEvent.click(dialog.getByRole("button", { name: "Rename Room 1" }));
    fireEvent.change(dialog.getByLabelText("Room name"), { target: { value: "Lab" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save name" }));
    expect(await dialog.findByRole("status")).toHaveTextContent("Room renamed");
    expect(renameRoom).toHaveBeenCalledWith({ organizationId: "org-1", roomId: "room-1", name: "Lab" });

    fireEvent.click(dialog.getByRole("button", { name: "Remove Room 2" }));
    expect(dialog.getByText(/Its display will be unassigned/)).toBeInTheDocument();
    expect(removeRoom).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: /^Remove room$/ }));
    expect(await dialog.findByRole("status")).toHaveTextContent("Room removed");
    expect(removeRoom).toHaveBeenCalledWith({ organizationId: "org-1", roomId: "room-2" });
  });

  it("keeps operational timestamps and the platform subtitle off the display card", () => {
    queriedFleet = { ...fleet, devices: [{ ...fleet.devices[0], openedAt: Date.parse("2026-11-16T14:30:03Z") }] };
    render(<DisplayAdmin />);
    expect(screen.getByRole("heading", { name: "Tablet A" })).toBeInTheDocument();
    expect(screen.queryByText("Last seen")).not.toBeInTheDocument();
    expect(screen.queryByText("Launch reported")).not.toBeInTheDocument();
    expect(screen.queryByText("9:30:03 AM", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("iPad")).not.toBeInTheDocument();
  });

  it("edits the name and type of a registered display without changing its room", async () => {
    render(<DisplayAdmin />);
    const edit = screen.getByRole("button", { name: "Edit Tablet A" });
    fireEvent.click(edit);
    const dialog = within(screen.getByRole("dialog", { name: "Edit display" }));
    expect(dialog.getByLabelText("Name or asset tag")).toHaveValue("Tablet A");
    expect(dialog.getByLabelText("Display type")).toHaveValue("ipad");
    expect(dialog.getByRole("button", { name: "Save display" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Name or asset tag"), { target: { value: "Hall display" } });
    fireEvent.change(dialog.getByLabelText("Display type"), { target: { value: "android" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save display" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Display updated");
    expect(updateDisplay).toHaveBeenCalledWith({ organizationId: "org-1", deviceId: "device-1", label: "Hall display", platform: "android" });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(edit).toHaveFocus();
  });

  it("keeps the edit open with the entered name if saving fails", async () => {
    updateDisplay.mockRejectedValueOnce(new ConvexError("Display is unavailable."));
    render(<DisplayAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Tablet A" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit display" }));
    fireEvent.change(dialog.getByLabelText("Name or asset tag"), { target: { value: "Hall display" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save display" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Display is unavailable.");
    expect(dialog.getByLabelText("Name or asset tag")).toHaveValue("Hall display");
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
