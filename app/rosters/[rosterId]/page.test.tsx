import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RosterDetailPage from "./page";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockPush = vi.fn();
const mockRenameRoster = vi.fn();
const mockDeleteRoster = vi.fn();
const mockStartSession = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    use: (value: unknown) => value,
  };
});

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/components/clerk-header-controls", () => ({
  ClerkHeaderControls: () => null,
}));

const rosterDetail = {
  roster: {
    _id: "roster-1",
    name: "Homeroom",
    createdAt: 1_710_000_000_000,
  },
  students: [
    {
      _id: "participant-1",
      studentId: "1001",
      schoolEmail: "alice@example.edu",
      rawName: "Able, Alice",
      firstName: "Alice",
      lastName: "Able",
      displayName: "Alice Able",
      active: true,
      linkStatus: "linked" as const,
      linkedAppUserId: "app-user-1",
    },
  ],
  sessions: [
    {
      _id: "session-1",
      title: "Homeroom",
      date: "2026-04-04",
      status: "open" as const,
      checkInToken: "check-in-token-1",
      createdAt: 1_710_000_000_000,
    },
  ],
};

const sessionExport = {
  roster: {
    _id: "roster-1",
    name: "Homeroom",
  },
  session: {
    _id: "session-1",
    title: "Homeroom",
    date: "2026-04-04",
    status: "open" as const,
  },
  rows: [
    {
      studentId: "1001",
      schoolEmail: "alice@example.edu",
      rawName: "Able, Alice",
      displayName: "Alice Able",
      firstName: "Alice",
      lastName: "Able",
      status: "present" as const,
      present: true,
      markedAt: 1_742_000_000_000,
      modifiedAt: 1_742_000_000_000,
    },
  ],
};

function renderPage() {
  return render(<RosterDetailPage params={{ rosterId: "roster-1" } as never} />);
}

describe("RosterDetailPage", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockPush.mockReset();
    mockRenameRoster.mockReset();
    mockDeleteRoster.mockReset();
    mockStartSession.mockReset();

    mockUseQuery.mockImplementation((_: unknown, args: unknown) => {
      if (args && typeof args === "object" && "rosterId" in args) {
        if ((args as { rosterId: string }).rosterId === "roster-1") {
          return rosterDetail;
        }
      }

      if (args && typeof args === "object" && "sessionId" in args) {
        return sessionExport;
      }

      return undefined;
    });

    mockUseQuery
      .mockReturnValueOnce(rosterDetail)
      .mockReturnValueOnce(sessionExport);

    mockRenameRoster.mockResolvedValue(undefined);
    mockDeleteRoster.mockResolvedValue(undefined);
    mockStartSession.mockResolvedValue("session-new");

    mockUseMutation
      .mockReturnValueOnce(mockRenameRoster)
      .mockReturnValueOnce(mockDeleteRoster)
      .mockReturnValueOnce(mockStartSession);
  });

  it("opens the live session when an active session exists", () => {
    renderPage();

    expect(screen.getByRole("link", { name: /Open Attendance/i })).toHaveAttribute(
      "href",
      "/rosters/roster-1/sessions/session-1",
    );
  });

  it("starts attendance from the roster detail page", async () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((_: unknown, args: unknown) => {
      if (args && typeof args === "object" && "rosterId" in args) {
        return {
          ...rosterDetail,
          sessions: [],
        };
      }

      return undefined;
    });

    mockUseMutation.mockReset();
    mockUseMutation
      .mockReturnValueOnce(mockRenameRoster)
      .mockReturnValueOnce(mockDeleteRoster)
      .mockReturnValueOnce(mockStartSession);

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Start Attendance/i }));

    await waitFor(() => {
      expect(mockStartSession).toHaveBeenCalledWith({
        rosterId: "roster-1",
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/rosters/roster-1/sessions/session-new");
    });
  });

  it("does not render participant linking controls", () => {
    renderPage();

    expect(screen.queryByText("Participant Linking")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Auto-link/i })).not.toBeInTheDocument();
  });

  it("renders the missing roster state without loading session export", () => {
    mockUseQuery.mockReset();
    mockUseQuery
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(undefined);

    renderPage();

    expect(screen.getByText("This roster does not exist.")).toBeInTheDocument();
    expect(mockUseQuery).toHaveBeenNthCalledWith(2, expect.anything(), "skip");
  });
});
