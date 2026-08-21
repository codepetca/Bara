import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

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
    handleAuthkitHeadersMock.mockReturnValue(NextResponse.next());
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
    const request = new NextRequest("https://bara.example/check-in/token-1");

    const response = await proxy(request);
    const securedRequest = authkitMock.mock.calls[0]?.[0] as NextRequest;

    expect(authkitMock).toHaveBeenCalledWith(securedRequest, { eagerAuth: true });
    expect(securedRequest).not.toBe(request);
    expect(securedRequest.headers.get("x-nonce")).toBeTruthy();
    expect(securedRequest.headers.get("content-security-policy")).toContain("script-src");
    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(securedRequest, headers, {
      redirect: authorizationUrl,
    });
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("passes authenticated and public requests through with AuthKit headers", async () => {
    const headers = new Headers({ "x-workos-session": "sealed" });
    authkitMock.mockResolvedValue({
      session: { user: { id: "user_1" } },
      headers,
      authorizationUrl: "https://example.authkit.app/authorize",
    });
    const { default: proxy } = await import("./proxy");
    const request = new NextRequest("https://bara.example/");

    const response = await proxy(request);
    const securedRequest = authkitMock.mock.calls[0]?.[0] as NextRequest;

    expect(authkitMock).toHaveBeenCalledWith(securedRequest, { eagerAuth: true });
    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(securedRequest, headers);
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'none'");
  });
});
