import { describe, expect, it } from "vitest";
import { getAuthCallbackUrl, getSafeReturnTo } from "./auth-routes";

describe("auth route helpers", () => {
  it("builds callback URLs from the active request origin", () => {
    expect(getAuthCallbackUrl("http://localhost:3002/sign-in?returnTo=/rosters")).toBe(
      "http://localhost:3002/callback",
    );
    expect(getAuthCallbackUrl("https://tapcheck.codepet.ca/attendance/create")).toBe(
      "https://tapcheck.codepet.ca/callback",
    );
  });

  it("only allows relative return paths", () => {
    expect(getSafeReturnTo("/rosters")).toBe("/rosters");
    expect(getSafeReturnTo("//evil.test")).toBeUndefined();
    expect(getSafeReturnTo("https://evil.test")).toBeUndefined();
  });
});
