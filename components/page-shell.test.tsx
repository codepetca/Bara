import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageShell } from "./page-shell";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/clerk-header-controls", () => ({
  ClerkHeaderControls: () => null,
}));

describe("PageShell", () => {
  it("shows a home icon link in the header", () => {
    render(
      <PageShell title="Roster" backHref="/" backLabel="Back">
        <div>Body</div>
      </PageShell>,
    );

    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink).toHaveAttribute("title", "Home");
    expect(homeLink.querySelector("svg")).toHaveClass("h-5", "w-5");
  });
});
