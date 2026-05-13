import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { SessionDisplayScreen } from "./session-display-screen";

const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const openFixture = {
  displayContext: {
    title: "Homeroom",
    rosterName: "Homeroom",
    checkInToken: "check-in-token-1",
    status: "open" as const,
  },
  liveSession: {
    counts: {
      total: 2,
      present: 1,
      late: 0,
      unmarked: 1,
      absent: 0,
    },
  },
};

describe("SessionDisplayScreen", () => {
  it("uses the public token queries when rendered from a shared display link", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValue(openFixture);

    render(<SessionDisplayScreen token="shared-token-1" fixtureDisplay={openFixture} />);

    expect(getFunctionName(mockUseQuery.mock.calls[0]?.[0])).toBe("sessions:getDisplayContextByToken");
    expect(getFunctionName(mockUseQuery.mock.calls[1]?.[0])).toBe("attendance:getLiveSessionRowsByToken");
  });

  it("renders the QR code while the session is open", () => {
    const { container } = render(
      <SessionDisplayScreen sessionId="session-1" fixtureDisplay={openFixture} />,
    );

    expect(screen.getByRole("heading", { name: "Homeroom" })).toBeInTheDocument();
    expect(screen.queryByText("Attendance is closed")).not.toBeInTheDocument();
    expect(screen.getByText("Scan, sign in, then check in.")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("replaces the QR code with a closed-state notice when attendance is closed", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValue(openFixture);

    const { container } = render(
      <SessionDisplayScreen
        token="shared-token-1"
        fixtureDisplay={{
          ...openFixture,
          displayContext: {
            ...openFixture.displayContext,
            status: "closed",
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: /Homeroom/i })).toBeInTheDocument();
    expect(screen.getByText("Attendance is closed")).toBeInTheDocument();
    expect(screen.getByText("This QR code is no longer active.")).toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-amber-50/35");
    expect(container.querySelector(".border-amber-200")).not.toBeNull();
    expect(container.querySelector('[aria-label="QR Code"]')).toBeNull();
  });

  it("keeps the QR code shareable before attendance opens", () => {
    const { container } = render(
      <SessionDisplayScreen
        token="roster-share-token-1"
        fixtureDisplay={{
          ...openFixture,
          displayContext: {
            ...openFixture.displayContext,
            checkInToken: "roster-share-token-1",
            status: "not_open",
          },
          liveSession: {
            counts: {
              total: 2,
              present: 0,
              late: 0,
              unmarked: 2,
              absent: 0,
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Attendance is not open yet")).toBeInTheDocument();
    expect(screen.getByText("Share this QR now. Check-in starts when attendance opens.")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
