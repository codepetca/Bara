import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSignUpUrlMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignUpUrl: (...args: unknown[]) => getSignUpUrlMock(...args),
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

describe("sign-up route", () => {
  beforeEach(() => {
    getSignUpUrlMock.mockReset();
    redirectMock.mockReset();
  });

  it("uses the current request origin for the WorkOS callback URL", async () => {
    getSignUpUrlMock.mockResolvedValue("https://auth.workos.test/signup");
    const { GET } = await import("./route");

    await GET(createRequest("http://localhost:3003/sign-up"));

    expect(getSignUpUrlMock).toHaveBeenCalledWith({
      redirectUri: "http://localhost:3003/callback",
    });
    expect(redirectMock).toHaveBeenCalledWith("https://auth.workos.test/signup");
  });
});
