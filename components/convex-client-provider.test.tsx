import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexClientProvider } from "./convex-client-provider";

type MockAuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
};

const mockState = vi.hoisted(() => ({
  auth: {
    user: { id: "workos-user-1" },
    loading: false,
  },
  token: {
    loading: false,
    getAccessToken: vi.fn(async () => "cached-token"),
    refresh: vi.fn(async () => "fresh-token"),
  },
  latestAuth: null as MockAuthState | null,
}));

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  AuthKitProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAccessToken: () => mockState.token,
  useAuth: () => mockState.auth,
}));

vi.mock("convex/react", () => ({
  ConvexProviderWithAuth: ({
    children,
    useAuth,
  }: {
    children: ReactNode;
    useAuth: () => MockAuthState;
  }) => {
    const auth = useAuth();
    mockState.latestAuth = auth;

    return (
      <div
        data-authenticated={String(auth.isAuthenticated)}
        data-loading={String(auth.isLoading)}
        data-testid="convex-auth"
      >
        {children}
      </div>
    );
  },
  ConvexReactClient: vi.fn(),
}));

describe("ConvexClientProvider", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    mockState.auth = {
      user: { id: "workos-user-1" },
      loading: false,
    };
    mockState.token = {
      loading: false,
      getAccessToken: vi.fn(async () => "cached-token"),
      refresh: vi.fn(async () => "fresh-token"),
    };
    mockState.latestAuth = null;
  });

  it("does not reset Convex auth loading while AuthKit is refreshing a token", () => {
    mockState.token.loading = true;

    render(
      <ConvexClientProvider>
        <div>App</div>
      </ConvexClientProvider>,
    );

    expect(screen.getByTestId("convex-auth")).toHaveAttribute("data-authenticated", "true");
    expect(screen.getByTestId("convex-auth")).toHaveAttribute("data-loading", "false");
  });

  it("uses cached and forced refresh token fetches for Convex auth", async () => {
    render(
      <ConvexClientProvider>
        <div>App</div>
      </ConvexClientProvider>,
    );

    await expect(mockState.latestAuth?.fetchAccessToken({ forceRefreshToken: false })).resolves.toBe("cached-token");
    await expect(mockState.latestAuth?.fetchAccessToken({ forceRefreshToken: true })).resolves.toBe("fresh-token");

    expect(mockState.token.getAccessToken).toHaveBeenCalledTimes(1);
    expect(mockState.token.refresh).toHaveBeenCalledTimes(1);
  });
});
