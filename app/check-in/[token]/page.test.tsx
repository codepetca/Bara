import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentCheckInPage from "./page";

const withAuthMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: (...args: unknown[]) => withAuthMock(...args),
}));

vi.mock("@/components/student-check-in-screen", () => ({
  StudentCheckInScreen: ({ token }: { token: string }) => <div>Check in with {token}</div>,
}));

describe("StudentCheckInPage", () => {
  beforeEach(() => {
    withAuthMock.mockReset();
    withAuthMock.mockResolvedValue({ user: { id: "user_1" } });
  });

  it("requires a WorkOS session before rendering the scanned token", async () => {
    const page = await StudentCheckInPage({
      params: Promise.resolve({ token: "session-token-1" }),
    });

    render(page);

    expect(withAuthMock).toHaveBeenCalledWith({ ensureSignedIn: true });
    expect(screen.getByText("Check in with session-token-1")).toBeInTheDocument();
  });
});
