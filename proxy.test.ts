import { beforeEach, describe, expect, it, vi } from "vitest";

const authkitMock = vi.fn();
const handleAuthkitHeadersMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: (...args: unknown[]) => authkitMock(...args),
  handleAuthkitHeaders: (...args: unknown[]) => handleAuthkitHeadersMock(...args),
}));

describe("proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    authkitMock.mockReset();
    handleAuthkitHeadersMock.mockReset();
    handleAuthkitHeadersMock.mockReturnValue({ ok: true });
  });

  it("protects app-owned routes while leaving shared token and auth routes public", async () => {
    const { isProtectedRoute } = await import("./proxy");

    expect(isProtectedRoute("/")).toBe(true);
    expect(isProtectedRoute("/rosters/import")).toBe(true);
    expect(isProtectedRoute("/rosters/roster-1/sessions/session-1")).toBe(true);
    expect(isProtectedRoute("/check-in/token-1")).toBe(true);
    expect(isProtectedRoute("/sign-in")).toBe(false);
    expect(isProtectedRoute("/sign-up")).toBe(false);
    expect(isProtectedRoute("/callback")).toBe(false);
    expect(isProtectedRoute("/s/edit/editor-token-1")).toBe(false);
    expect(isProtectedRoute("/s/display/display-token-1")).toBe(false);
  });

  it("redirects signed-out users through the trusted AuthKit authorization URL", async () => {
    const authorizationUrl = "https://example.authkit.app/authorize";
    const headers = new Headers({ "x-workos-session": "sealed" });
    authkitMock.mockResolvedValue({
      session: { user: null },
      headers,
      authorizationUrl,
    });
    const { default: proxy } = await import("./proxy");
    const request = { nextUrl: { pathname: "/rosters" } };

    await proxy(request as never);

    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(request, headers, {
      redirect: authorizationUrl,
    });
  });

  it("passes authenticated and public requests through with AuthKit headers", async () => {
    const headers = new Headers({ "x-workos-session": "sealed" });
    authkitMock.mockResolvedValue({
      session: { user: { id: "user_1" } },
      headers,
      authorizationUrl: "https://example.authkit.app/authorize",
    });
    const { default: proxy } = await import("./proxy");
    const request = { nextUrl: { pathname: "/" } };

    await proxy(request as never);

    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(request, headers);
  });
});
