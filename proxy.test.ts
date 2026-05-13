import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { AUTH_CALLBACK_URL, SIGN_IN_URL, SIGN_UP_URL } from "./lib/auth-routes";
import { WORKOS_SETUP_URL } from "./lib/workos-config";

const authkitMock = vi.fn();
const handleAuthkitHeadersMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: (...args: unknown[]) => authkitMock(...args),
  handleAuthkitHeaders: (...args: unknown[]) => handleAuthkitHeadersMock(...args),
}));

function createRequest(pathname: string) {
  return {
    nextUrl: { pathname },
    url: `https://tapcheck.test${pathname}`,
  } as NextRequest;
}

describe("proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    authkitMock.mockReset();
    handleAuthkitHeadersMock.mockReset();
    process.env.WORKOS_CLIENT_ID = "client_test";
    process.env.WORKOS_API_KEY = "sk_test";
    process.env.WORKOS_COOKIE_PASSWORD = "a".repeat(32);
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "https://tapcheck.test/callback";
  });

  it("redirects to setup before calling AuthKit when WorkOS env is incomplete", async () => {
    delete process.env.WORKOS_API_KEY;
    const { default: proxy } = await import("./proxy");

    const response = await proxy(createRequest("/"));

    expect(authkitMock).not.toHaveBeenCalled();
    expect(response?.headers.get("location")).toBe(`https://tapcheck.test${WORKOS_SETUP_URL}`);
  });

  it("skips AuthKit session work for WorkOS auth endpoints", async () => {
    const { default: proxy } = await import("./proxy");

    await proxy(createRequest(SIGN_IN_URL));
    await proxy(createRequest(SIGN_UP_URL));
    await proxy(createRequest(AUTH_CALLBACK_URL));

    expect(authkitMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users away from protected Tapcheck routes", async () => {
    const headers = new Headers();
    authkitMock.mockResolvedValue({
      session: { user: null },
      headers,
      authorizationUrl: "https://auth.workos.test/login",
    });
    handleAuthkitHeadersMock.mockImplementation((_request, _headers, options) => options ?? null);

    const { default: proxy } = await import("./proxy");

    await proxy(createRequest("/"));
    await proxy(createRequest("/attendance/create"));
    await proxy(createRequest("/check-in/check-in-token-1"));
    await proxy(createRequest("/rosters/import"));

    expect(authkitMock).toHaveBeenCalledWith(expect.anything(), {
      redirectUri: "https://tapcheck.test/callback",
    });
    expect(handleAuthkitHeadersMock).toHaveBeenCalledTimes(4);
    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(
      expect.anything(),
      headers,
      { redirect: "https://auth.workos.test/login" },
    );
  });

  it("leaves shared token routes public while still forwarding AuthKit headers", async () => {
    const headers = new Headers();
    authkitMock.mockResolvedValue({
      session: { user: null },
      headers,
      authorizationUrl: "https://auth.workos.test/login",
    });
    handleAuthkitHeadersMock.mockImplementation(() => null);

    const { default: proxy } = await import("./proxy");

    await proxy(createRequest("/s/edit/editor-token-1"));
    await proxy(createRequest("/s/display/display-token-1"));

    expect(handleAuthkitHeadersMock).toHaveBeenCalledTimes(2);
    expect(handleAuthkitHeadersMock).toHaveBeenCalledWith(expect.anything(), headers);
  });
});
