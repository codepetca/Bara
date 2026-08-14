import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthHeaderControls } from "./auth-header-controls";

const useAuthMock = vi.fn();
const usePathnameMock = vi.fn();

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("AuthHeaderControls", () => {
  beforeEach(() => {
    usePathnameMock.mockReturnValue("/");
    useAuthMock.mockReset();
  });

  it("links signed-out users to the WorkOS entry routes", () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });

    render(<AuthHeaderControls />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/sign-up");
  });

  it("signs authenticated users out through AuthKit", () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ user: { id: "user_1" }, loading: false, signOut });

    render(<AuthHeaderControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledWith({ returnTo: "/" });
  });

  it("stays hidden on authentication routes", () => {
    usePathnameMock.mockReturnValue("/callback");
    useAuthMock.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });

    const { container } = render(<AuthHeaderControls />);

    expect(container).toBeEmptyDOMElement();
  });
});
