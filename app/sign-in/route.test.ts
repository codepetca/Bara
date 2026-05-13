import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSignInUrlMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignInUrl: (...args: unknown[]) => getSignInUrlMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

function createRequest(url: string) {
  return {
    nextUrl: new URL(url),
    url,
  } as NextRequest;
}

describe("sign-in route", () => {
  beforeEach(() => {
    getSignInUrlMock.mockReset();
    redirectMock.mockReset();
  });

  it("uses the current request origin for the WorkOS callback URL", async () => {
    getSignInUrlMock.mockResolvedValue("https://auth.workos.test/login");
    const { GET } = await import("./route");

    await GET(createRequest("http://localhost:3002/sign-in?returnTo=/rosters"));

    expect(getSignInUrlMock).toHaveBeenCalledWith({
      returnTo: "/rosters",
      redirectUri: "http://localhost:3002/callback",
    });
    expect(redirectMock).toHaveBeenCalledWith("https://auth.workos.test/login");
  });
});
