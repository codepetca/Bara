import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import RosterDetailPage from "./page";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockPush = vi.fn();
const mockRenameRoster = vi.fn();
const mockDeleteRoster = vi.fn();
const mockStartSession = vi.fn();
const mockCloseSession = vi.fn();
const mockSaveSchedule = vi.fn();
const mockClipboardWriteText = vi.fn();

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
    mode: "standalone" as const,
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
    {
      _id: "participant-2",
      studentId: "1003",
      schoolEmail: "john@example.edu",
      rawName: "Baker, John",
      firstName: "John",
      lastName: "Baker",
      displayName: "John Baker",
      active: true,
      linkStatus: "unlinked" as const,
      linkedAppUserId: undefined,
    },
    {
      _id: "participant-3",
      studentId: "1002",
      schoolEmail: "zoe@example.edu",
      rawName: "Carson, Zoe",
      firstName: "Zoe",
      lastName: "Carson",
      displayName: "Zoe Carson",
      active: true,
      linkStatus: "review_needed" as const,
      linkedAppUserId: undefined,
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
    {
      studentId: "1003",
      schoolEmail: "john@example.edu",
      rawName: "Baker, John",
      displayName: "John Baker",
      firstName: "John",
      lastName: "Baker",
      status: "unmarked" as const,
      present: false,
      markedAt: undefined,
      modifiedAt: 1_742_000_000_000,
    },
    {
      studentId: "1002",
      schoolEmail: "zoe@example.edu",
      rawName: "Carson, Zoe",
      displayName: "Zoe Carson",
      firstName: "Zoe",
      lastName: "Carson",
      status: "absent" as const,
      present: false,
      markedAt: undefined,
      modifiedAt: 1_742_000_000_000,
    },
  ],
};

const closedRosterDetail = {
  ...rosterDetail,
  sessions: [
    {
      _id: "session-closed-1",
      title: "Homeroom",
      date: "2026-04-03",
      status: "closed" as const,
      checkInToken: "check-in-token-closed",
      createdAt: 1_709_000_000_000,
    },
  ],
};

const closedSessionExport = {
  ...sessionExport,
  session: {
    ...sessionExport.session,
    _id: "session-closed-1",
    status: "closed" as const,
  },
};

const unopenedRosterDetail = {
  ...rosterDetail,
  sessions: [],
};

const standaloneScheduleDetails = {
  mode: "standalone" as const,
  schedule: {
    timezone: "America/Toronto",
    weekdays: ["monday", "wednesday", "friday"] as const,
    startMinutes: 490,
    endMinutes: 570,
    autoOpen: true,
    autoCloseGraceMinutes: 10,
    active: true,
  },
  externalLink: null,
  upcomingClassDays: [
    {
      _id: "class-day-1",
      date: "2026-04-06",
      status: "scheduled" as const,
      source: "generated" as const,
      timezone: "America/Toronto",
      startMinutes: 490,
      endMinutes: 570,
      autoOpen: true,
      autoCloseGraceMinutes: 10,
    },
  ],
};

const linkedScheduleDetails = {
  mode: "pika_linked" as const,
  schedule: null,
  externalLink: {
    provider: "pika" as const,
    externalClassroomId: "pika-classroom-1",
    syncStatus: "sync_needed" as const,
    lastSyncedAt: undefined,
  },
  upcomingClassDays: [],
};

function renderPage() {
  return render(<RosterDetailPage params={{ rosterId: "roster-1" } as never} />);
}

function fnName(reference: unknown) {
  return getFunctionName(reference as never);
}

function mockDefaultQueries() {
  mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
    if (fnName(query) === "rosters:getById") {
      if (args && typeof args === "object" && "rosterId" in args) {
        if ((args as { rosterId: string }).rosterId === "roster-1") {
          return rosterDetail;
        }
      }

      return undefined;
    }

    if (fnName(query) === "attendance:getSessionExport") {
      if (args === "skip") {
        return undefined;
      }

      if (args && typeof args === "object" && "sessionId" in args) {
        return sessionExport;
      }
    }

    if (fnName(query) === "schedules:getForRoster") {
      return standaloneScheduleDetails;
    }

    return undefined;
  });
}

function mockDefaultMutations() {
  mockUseMutation.mockImplementation((mutation: unknown) => {
    if (fnName(mutation) === "rosters:rename") {
      return mockRenameRoster;
    }

    if (fnName(mutation) === "rosters:remove") {
      return mockDeleteRoster;
    }

    if (fnName(mutation) === "sessions:start") {
      return mockStartSession;
    }

    if (fnName(mutation) === "sessions:close") {
      return mockCloseSession;
    }

    if (fnName(mutation) === "schedules:upsertForRoster") {
      return mockSaveSchedule;
    }

    return vi.fn();
  });
}

describe("RosterDetailPage", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockPush.mockReset();
    mockRenameRoster.mockReset();
    mockDeleteRoster.mockReset();
    mockStartSession.mockReset();
    mockCloseSession.mockReset();
    mockSaveSchedule.mockReset();
    mockClipboardWriteText.mockReset();
    vi.unstubAllEnvs();

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: mockClipboardWriteText },
    });

    mockDefaultQueries();

    mockRenameRoster.mockResolvedValue(undefined);
    mockDeleteRoster.mockResolvedValue(undefined);
    mockStartSession.mockResolvedValue("session-new");
    mockCloseSession.mockResolvedValue(undefined);
    mockSaveSchedule.mockResolvedValue(undefined);
    mockClipboardWriteText.mockResolvedValue(undefined);

    mockDefaultMutations();
  });

  it("shows close, tap attendance, qr attendance, and the restored roster header controls when attendance is open", () => {
    renderPage();

    expect(screen.getByRole("button", { name: /Close Attendance/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open tap attendance/i })).toHaveAttribute(
      "href",
      "/s/edit/check-in-token-1",
    );
    expect(screen.getByRole("button", { name: /Copy manual attendance link/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open qr attendance/i })).toHaveAttribute(
      "href",
      "/s/display/check-in-token-1",
    );
    expect(screen.getByRole("button", { name: /Copy attendance qr link/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit Roster/i })).toHaveAttribute(
      "href",
      "/rosters/import?rosterId=roster-1",
    );
    expect(screen.getByText("Tap Attendance")).toBeInTheDocument();
    expect(screen.getByText("QR Attendance")).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 3 students marked present")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Attendance$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Recurring attendance")).toBeInTheDocument();
    expect(screen.getByDisplayValue("08:10")).toBeInTheDocument();
    expect(screen.getByText("Upcoming class days")).toBeInTheDocument();
    expect(screen.getByLabelText("Present")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Linked")).toHaveLength(2);
  });

  it("saves the standalone recurring schedule from the roster detail page", async () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue("08:10"), { target: { value: "08:20" } });
    fireEvent.click(screen.getByRole("button", { name: /Save schedule/i }));

    await waitFor(() => {
      expect(mockSaveSchedule).toHaveBeenCalledWith({
        rosterId: "roster-1",
        config: expect.objectContaining({
          timezone: "America/Toronto",
          weekdays: ["monday", "wednesday", "friday"],
          startMinutes: 500,
          endMinutes: 570,
          autoOpen: true,
          autoCloseGraceMinutes: 10,
          active: true,
        }),
      });
    });
  });

  it("saves the roster title when inline editing loses focus", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Homeroom" }));

    const input = screen.getByDisplayValue("Homeroom");
    fireEvent.change(input, { target: { value: "Morning Homeroom" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockRenameRoster).toHaveBeenCalledWith({
        rosterId: "roster-1",
        name: "Morning Homeroom",
      });
    });
  });

  it("keeps tap attendance and qr attendance visible when the latest session is closed", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
      if (fnName(query) === "rosters:getById") {
        return closedRosterDetail;
      }

      if (fnName(query) === "attendance:getSessionExport") {
        if (args === "skip") {
          return undefined;
        }

        return closedSessionExport;
      }

      return undefined;
    });

    renderPage();

    expect(screen.getByRole("button", { name: /Open Attendance/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open tap attendance/i })).toHaveAttribute(
      "href",
      "/s/edit/check-in-token-closed",
    );
    expect(screen.getByRole("link", { name: /Open qr attendance/i })).toHaveAttribute(
      "href",
      "/s/display/check-in-token-closed",
    );
  });

  it("hides tap attendance and qr attendance when the roster has never opened attendance", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
      if (fnName(query) === "rosters:getById") {
        return unopenedRosterDetail;
      }

      if (fnName(query) === "attendance:getSessionExport") {
        expect(args).toBe("skip");
        return undefined;
      }

      return undefined;
    });

    renderPage();

    expect(screen.getByRole("button", { name: /Open Attendance/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Attendance$/i })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Open tap attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open qr attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy manual attendance link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy attendance qr link/i })).not.toBeInTheDocument();
  });

  it("copies the tap attendance link as an absolute public URL and shows temporary success state", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tapcheck.test");

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Copy manual attendance link/i }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("https://tapcheck.test/s/edit/check-in-token-1");
    });

    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("copies the qr attendance link as an absolute public URL and shows temporary success state", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tapcheck.test");

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Copy attendance qr link/i }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("https://tapcheck.test/s/display/check-in-token-1");
    });

    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("sorts the participant table by the selected column", () => {
    renderPage();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Alice");
    expect(rows[1]).toHaveTextContent("John");
    expect(rows[2]).toHaveTextContent("Zoe");

    fireEvent.click(screen.getByRole("button", { name: "ID" }));

    const sortedRows = screen.getAllByRole("row").slice(1);
    expect(sortedRows[0]).toHaveTextContent("Alice");
    expect(sortedRows[1]).toHaveTextContent("Zoe");
    expect(sortedRows[2]).toHaveTextContent("John");
  });

  it("closes attendance from the roster detail page", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Close Attendance/i }));

    await waitFor(() => {
      expect(mockCloseSession).toHaveBeenCalledWith({
        sessionId: "session-1",
      });
    });
  });

  it("opens attendance from the roster detail page without redirecting", async () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
      if (fnName(query) === "rosters:getById" && args && typeof args === "object" && "rosterId" in args) {
        return unopenedRosterDetail;
      }

      return undefined;
    });

    mockUseMutation.mockReset();
    mockDefaultMutations();

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Open Attendance/i }));

    await waitFor(() => {
      expect(mockStartSession).toHaveBeenCalledWith({
        rosterId: "roster-1",
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not render participant linking controls", () => {
    renderPage();

    expect(screen.queryByText("Participant Linking")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Auto-link/i })).not.toBeInTheDocument();
  });

  it("shows linked mode copy when the roster is pika-linked", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
      if (fnName(query) === "rosters:getById") {
        return {
          ...rosterDetail,
          roster: {
            ...rosterDetail.roster,
            mode: "pika_linked" as const,
          },
        };
      }

      if (fnName(query) === "attendance:getSessionExport") {
        if (args === "skip") {
          return undefined;
        }

        return sessionExport;
      }

      if (fnName(query) === "schedules:getForRoster") {
        return linkedScheduleDetails;
      }

      return undefined;
    });

    renderPage();

    expect(screen.getByText("Attendance source")).toBeInTheDocument();
    expect(screen.getByText("Linked classroom: pika-classroom-1")).toBeInTheDocument();
    expect(screen.getByText("Sync status: sync needed")).toBeInTheDocument();
  });

  it("renders the missing roster state without loading session export", () => {
    mockUseQuery.mockReset();
    mockUseQuery.mockImplementation((query: unknown, args: unknown) => {
      if (fnName(query) === "rosters:getById") {
        return null;
      }

      if (fnName(query) === "attendance:getSessionExport") {
        expect(args).toBe("skip");
        return undefined;
      }

      return undefined;
    });

    renderPage();

    expect(screen.getByText("This roster does not exist.")).toBeInTheDocument();
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({}), "skip");
  });
});
