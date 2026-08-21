import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(...args: unknown[]) {
      mocks.constructor(...args);
    }

    mutation(...args: unknown[]) {
      return mocks.mutation(...args);
    }
  },
}));

import { api } from "@/convex/api";
import { bootstrapCurrentAppUser } from "./bootstrap-current-app-user";

describe("bootstrapCurrentAppUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://attendance-test.convex.cloud");
    mocks.mutation.mockResolvedValue({ _id: "app_user_one" });
  });

  it("uses the WorkOS token to resolve the current attendance identity", async () => {
    await expect(bootstrapCurrentAppUser("workos-access-token")).resolves.toEqual({
      _id: "app_user_one",
    });

    expect(mocks.constructor).toHaveBeenCalledWith(
      "https://attendance-test.convex.cloud",
      { auth: "workos-access-token", logger: false },
    );
    expect(mocks.mutation).toHaveBeenCalledWith(api.appUsers.ensureCurrent, {});
  });

  it("rejects missing tokens and unsafe deployment URLs before contacting Convex", async () => {
    await expect(bootstrapCurrentAppUser("  ")).rejects.toThrow("access token");
    expect(mocks.constructor).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://convex.example");
    await expect(bootstrapCurrentAppUser("workos-access-token")).rejects.toThrow("not configured");
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
});
