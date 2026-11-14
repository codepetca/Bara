import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.fn();
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { mutation = mutation; } }));
vi.mock("@/convex/api", () => ({ api: { rooms: { beginScan: "beginScan" } } }));
import { GET } from "./route";

describe("room scan entry", () => {
  beforeEach(() => { mutation.mockReset(); mutation.mockResolvedValue("continuation"); process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud"; });
  it("captures a proof with a fresh browser key and redirects without it", async () => {
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?proof=secret"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in");
    expect(mutation).toHaveBeenCalledWith("beginScan", expect.objectContaining({ roomId: "room1", proof: "secret", browserKey: expect.any(String) }));
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain("secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("still reaches staff controls when a proof is unavailable", async () => {
    mutation.mockRejectedValue(new Error("invalid"));
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?proof=old"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in");
  });
});
