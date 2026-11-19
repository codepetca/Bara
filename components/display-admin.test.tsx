import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayAdmin } from "./display-admin";

const register = vi.fn();
const assign = vi.fn();
const addRoom = vi.fn();
const renameRoom = vi.fn();
const removeRoom = vi.fn();
const setStudentPoster = vi.fn();
const setSchoolLocation = vi.fn();
const push = vi.fn();
const fleet = { rooms: [{ roomId: "room-1", label: "Room 1", occupied: false }, { roomId: "room-2", label: "Room 2", occupied: true }] as
  { roomId: string; label: string; occupied: boolean; studentPosterKey?: string | null }[],
  devices: [{ deviceId: "device-1", label: "Tablet A", platform: "ipad", roomId: null, lastSeenAt: null, openedAt: null as number | null }] };
let queriedFleet: typeof fleet & { schoolLocationName?: string | null } = fleet;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth-header-controls", () => ({ AuthHeaderControls: () => null }));
vi.mock("@/components/use-current-app-user", () => ({ useCurrentAppUser: () => ({ isReady: true }) }));
vi.mock("react-qr-code", () => ({
  default: ({ value, "aria-label": label }: { value: string; "aria-label"?: string }) => <svg aria-label={label} data-qr-value={value} />,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => getFunctionName(ref) === "displayPairing:adminOptions" ? { organizations: [{ organizationId: "org-1", name: "School" }] } : queriedFleet,
  useMutation: (ref: never) => ({
    "displayPairing:register": register,
    "displayPairing:assign": assign,
    "displayPairing:addRoom": addRoom,
    "displayPairing:renameRoom": renameRoom,
    "displayPairing:removeRoom": removeRoom,
    "displayPairing:setStudentPoster": setStudentPoster,
    "displayPairing:setSchoolLocation": setSchoolLocation,
  })[getFunctionName(ref)],
}));

beforeEach(() => { vi.clearAllMocks(); queriedFleet = fleet; register.mockResolvedValue({ deviceId: "device-1" }); assign.mockResolvedValue(null); setSchoolLocation.mockResolvedValue(null); });
afterEach(() => { vi.unstubAllEnvs(); });

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
    expect(screen.getByText("Last seen")).toBeInTheDocument();
    expect(screen.getByText("Launch reported")).toBeInTheDocument();
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

  it("saves a school location without changing the display room", async () => {
    queriedFleet = { ...fleet, schoolLocationName: null };
    const { rerender } = render(<DisplayAdmin />);
    fireEvent.change(screen.getByLabelText("Room for Tablet A"), { target: { value: "edit-rooms" } });
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    const input = dialog.getByLabelText("School location");
    expect(dialog.getByRole("button", { name: "Save location" })).toBeDisabled();
    fireEvent.change(input, { target: { value: " PETHS   School " } });
    fireEvent.click(dialog.getByRole("button", { name: "Save location" }));
    await waitFor(() => expect(setSchoolLocation).toHaveBeenCalledWith({ organizationId: "org-1", name: "PETHS School" }));
    expect(await dialog.findByRole("status")).toHaveTextContent("School location saved");
    expect(assign).not.toHaveBeenCalled();
    queriedFleet = { ...fleet, schoolLocationName: "PETHS School" };
    rerender(<DisplayAdmin />);
    expect(input).toHaveValue("PETHS School");
    expect(dialog.getByRole("button", { name: "Save location" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "PETHS draft" } });
    queriedFleet = { ...queriedFleet, rooms: [...fleet.rooms] };
    rerender(<DisplayAdmin />);
    expect(input).toHaveValue("PETHS draft");
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    expect(screen.getByLabelText("Room for Tablet A")).toHaveValue("");
  });

  it("keeps the location on failure and prevents closing while saving", async () => {
    let rejectSave!: (error: Error) => void;
    setSchoolLocation.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
    render(<DisplayAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rooms" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    fireEvent.change(dialog.getByLabelText("School location"), { target: { value: "PETHS" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save location" }));
    expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
    rejectSave(new Error("failed"));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Could not save the school location");
    expect(dialog.getByLabelText("School location")).toHaveValue("PETHS");
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

  it("enables a student poster from Edit rooms with no registered display", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://canonical.bara.example");
    queriedFleet = { rooms: [{ roomId: "room-223", label: "223", occupied: false }], devices: [] };
    const { rerender } = render(<DisplayAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rooms" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    fireEvent.click(dialog.getByRole("button", { name: "Student QR for 223" }));
    expect(dialog.queryByRole("button", { name: "Print poster" })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Enable student QR" }));
    await waitFor(() => expect(setStudentPoster).toHaveBeenCalledWith({
      organizationId: "org-1", roomId: "room-223", action: "enable", currentKey: null,
    }));
    queriedFleet = { ...queriedFleet, rooms: [{ ...queriedFleet.rooms[0]!, studentPosterKey: "published-key" }] };
    rerender(<DisplayAdmin />);
    expect(dialog.getByLabelText("Student attendance QR for 223")).toHaveAttribute(
      "data-qr-value", "https://canonical.bara.example/rooms/room-223/scan?poster=published-key",
    );
    expect(dialog.getByRole("heading", { name: "223 student QR" })).toHaveFocus();

    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      fireEvent.click(dialog.getByRole("button", { name: "Print poster" }));
      expect(print).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-room-poster-print]")).toHaveTextContent("Scan to check in");
      expect(document.body.dataset.printRoomPoster).toBe("true");
      window.dispatchEvent(new Event("afterprint"));
      expect(document.body.dataset.printRoomPoster).toBeUndefined();
    } finally {
      print.mockRestore();
    }

    fireEvent.click(dialog.getByRole("button", { name: "Replace QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("stop working");
    expect(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(setStudentPoster).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole("button", { name: "Replace printed QR" }));
    await waitFor(() => expect(setStudentPoster).toHaveBeenLastCalledWith({
      organizationId: "org-1", roomId: "room-223", action: "replace", currentKey: "published-key",
    }));
  });

  it("dismisses a confirmation when another admin replaces the QR", () => {
    queriedFleet = { rooms: [{ roomId: "room-223", label: "223", occupied: false, studentPosterKey: "old-key" }], devices: [] };
    const { rerender } = render(<DisplayAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rooms" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit rooms" }));
    fireEvent.click(dialog.getByRole("button", { name: "Student QR for 223" }));
    fireEvent.click(dialog.getByRole("button", { name: "Turn off" }));
    expect(dialog.getByRole("button", { name: "Turn off printed QR" })).toBeInTheDocument();
    queriedFleet = { ...queriedFleet, rooms: [{ ...queriedFleet.rooms[0]!, studentPosterKey: "new-key" }] };
    rerender(<DisplayAdmin />);
    expect(dialog.queryByRole("button", { name: "Turn off printed QR" })).not.toBeInTheDocument();
    expect(dialog.getByRole("heading", { name: "223 student QR" })).toHaveFocus();
    expect(setStudentPoster).not.toHaveBeenCalled();
  });

  it("formats display timestamps consistently in the school timezone", () => {
    queriedFleet = { ...fleet, devices: [{ ...fleet.devices[0], openedAt: Date.parse("2026-11-16T14:30:03Z") }] };
    render(<DisplayAdmin />);
    expect(screen.getByText("Mon Nov 16, 2026 · 9:30:03 AM")).toBeInTheDocument();
  });
});
