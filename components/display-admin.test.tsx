import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayAdmin } from "./display-admin";

const register = vi.fn();
const assign = vi.fn();
const push = vi.fn();
const fleet = { rooms: [{ roomId: "room-1", label: "Room 1", occupied: false }, { roomId: "room-2", label: "Room 2", occupied: true }], devices: [{ deviceId: "device-1", label: "Tablet A", platform: "ipad", roomId: null, lastSeenAt: null, openedAt: null }] };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth-header-controls", () => ({ AuthHeaderControls: () => null }));
vi.mock("@/components/use-current-app-user", () => ({ useCurrentAppUser: () => ({ isReady: true }) }));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => getFunctionName(ref) === "displayPairing:adminOptions" ? { organizations: [{ organizationId: "org-1", name: "School" }] } : fleet,
  useMutation: (ref: never) => getFunctionName(ref) === "displayPairing:register" ? register : assign,
}));

beforeEach(() => { vi.clearAllMocks(); register.mockResolvedValue({ deviceId: "device-1" }); assign.mockResolvedValue(null); });

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

  it("assigns a registered display to an available room", async () => {
    render(<DisplayAdmin />);
    expect(screen.getByText(/Last seen: Never/)).toHaveTextContent("Display opened: Never");
    fireEvent.change(screen.getByLabelText("Room for Tablet A"), { target: { value: "room-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save room" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ organizationId: "org-1", deviceId: "device-1", roomId: "room-1" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Updated Tablet A");
  });
});
