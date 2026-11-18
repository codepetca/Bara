import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.fn();
const withAuth = vi.fn();
const bootstrap = vi.fn();
const query = vi.fn();
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { mutation = mutation; query = query; } }));
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
vi.mock("@/lib/server/bootstrap-current-app-user", () => ({ bootstrapCurrentAppUser: (...args: unknown[]) => bootstrap(...args) }));
vi.mock("@/convex/api", () => ({ api: { rooms: { beginScan: "beginScan", beginPosterScan: "beginPosterScan", scanApps: "scanApps" } } }));
import { GET } from "./route";

describe("room scan entry", () => {
  beforeEach(() => {
    mutation.mockReset();
    mutation.mockResolvedValue("continuation");
    query.mockReset();
    query.mockResolvedValue(null);
    withAuth.mockReset();
    withAuth.mockResolvedValue({ accessToken: "signed-in" });
    bootstrap.mockReset();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  });
  it("captures a proof with a fresh browser key and redirects without it", async () => {
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?proof=secret"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in");
    expect(mutation).toHaveBeenCalledWith("beginScan", expect.objectContaining({ roomId: "room1", proof: "secret", browserKey: expect.any(String) }));
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain("secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withAuth).not.toHaveBeenCalled();
  });
  it("clears an earlier scan and never captures a proof from a saved closed-room URL", async () => {
    const params = Promise.resolve({ roomId: "room1" });
    const request = new Request("https://bara.test/rooms/room1/scan", {
      headers: { Cookie: "bara-room-scan=previous" },
    });
    const response = await GET(request, { params });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in?closed=1");
    expect(response.headers.get("set-cookie")).toMatch(/^bara-room-scan=;.*Expires=/i);
    expect(mutation).not.toHaveBeenCalled();
  });
  it("captures a printed QR without forwarding the poster key", async () => {
    mutation.mockResolvedValue({ status: "captured", continuation: "poster-continuation" });
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?poster=printed-key&app=bara"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(mutation).toHaveBeenCalledWith("beginPosterScan", { roomId: "room1", posterKey: "printed-key", browserKey: expect.any(String) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in");
    expect(response.headers.get("set-cookie")).toContain("poster-continuation");
    expect(response.headers.get("set-cookie")).not.toContain("printed-key");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(withAuth).toHaveBeenCalledWith({ ensureSignedIn: true });
    expect(bootstrap).toHaveBeenCalledWith("signed-in");
  });
  it("reports a closed poster and discards any earlier continuation", async () => {
    mutation.mockResolvedValue({ status: "closed" });
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?poster=printed-key&app=bara"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in?closed=1");
    expect(response.headers.get("set-cookie")).toMatch(/^bara-room-scan=;.*Expires=/i);
  });
  it("routes a Pika-only poster before either capture or Bara sign-in", async () => {
    query.mockResolvedValue({ bara: false, pikaOrigin: "https://pika.codepet.ca" });
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?poster=printed-key"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(query).toHaveBeenCalledWith("scanApps", { roomId: "room1", posterKey: "printed-key" });
    expect(response.headers.get("location")).toBe("https://pika.codepet.ca/attendance/room/room1/scan?poster=printed-key");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(withAuth).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });
  it("offers both apps for a mixed live QR, while ordinary posters continue to Bara", async () => {
    const params = { params: Promise.resolve({ roomId: "room1" }) };
    query.mockResolvedValueOnce({ bara: true, pikaOrigin: "https://pika.codepet.ca" });
    const shared = await GET(new Request("https://bara.test/rooms/room1/scan?proof=live"), params);
    const standalone = await GET(new Request("https://bara.test/rooms/room1/scan?poster=paper"), params);
    expect(shared.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in-app?proof=live");
    expect(standalone.headers.get("location")).toBe("https://bara.test/rooms/room1/scan?poster=paper&app=bara");
    expect(mutation).not.toHaveBeenCalled();
  });
  it("still reaches staff controls when a proof is unavailable", async () => {
    mutation.mockRejectedValue(new Error("invalid"));
    const response = await GET(new Request("https://bara.test/rooms/room1/scan?proof=old"), { params: Promise.resolve({ roomId: "room1" }) });
    expect(response.headers.get("location")).toBe("https://bara.test/rooms/room1/check-in");
  });
});
