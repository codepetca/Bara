import { beforeEach, describe, expect, it, vi } from "vitest";
const { mutation, query, getCookie } = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), getCookie: vi.fn() }));
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn().mockResolvedValue({ accessToken: "token" }) }));
vi.mock("@/lib/server/bootstrap-current-app-user", () => ({ bootstrapCurrentAppUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: getCookie }) }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { mutation = mutation; query = query; } }));
vi.mock("@/convex/api", () => ({ api: { rooms: { redeemScan: "redeemScan", scanContext: "scanContext" } } }));
import { redeemRoomScan, roomContext } from "./actions";

describe("room scan binding", () => {
  beforeEach(() => { mutation.mockReset(); getCookie.mockReturnValue({ value: JSON.stringify({ roomId: "room", browserKey: "secret", continuation: "scan-b" }) }); });
  it("ignores a stored attendance scan when loading the closed room for staff controls", async () => {
    query.mockResolvedValue({ canCheckIn: false });
    expect(await roomContext("room", true)).toEqual({ context: { canCheckIn: false }, scanId: null });
    expect(query).toHaveBeenCalledWith("scanContext", { roomId: "room" });
  });
  it("does not redeem a scan that replaced the one rendered in another tab", async () => {
    expect(await redeemRoomScan("room", "scan-a")).toEqual({ status: "invalid", results: [] });
    expect(mutation).not.toHaveBeenCalled();
  });
  it("redeems only the matching scan using the server-held browser key", async () => {
    mutation.mockResolvedValue({ status: "complete", results: [] });
    await redeemRoomScan("room", "scan-b");
    expect(mutation).toHaveBeenCalledWith("redeemScan", { roomId: "room", continuation: "scan-b", browserKey: "secret" });
  });
});
