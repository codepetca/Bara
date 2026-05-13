import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentCheckInScreen } from "./student-check-in-screen";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockUseCurrentAppUser = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/components/use-current-app-user", () => ({
  useCurrentAppUser: () => mockUseCurrentAppUser(),
}));

const mockCheckIn = vi.fn();

describe("StudentCheckInScreen", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockUseCurrentAppUser.mockReset();
    mockCheckIn.mockReset();

    mockUseQuery.mockReturnValue(undefined);
    mockUseMutation.mockReturnValue(mockCheckIn);
    mockUseCurrentAppUser.mockReturnValue({
      currentAppUser: null,
      isReady: false,
      bootstrapError: null,
    });
  });

  it("renders a full-screen green confirmation with large student identity details", () => {
    const { container } = render(
      <StudentCheckInScreen
        token="check-in-token"
        fixtureState={{
          context: {
            roster: { name: "Grade 7 Homeroom" },
            session: { title: "Homeroom", status: "open" },
          },
          result: {
            code: "present_marked",
            title: "You are checked in",
            description: "Attendance recorded successfully.",
            tone: "green",
            attendanceStatus: "present",
            checkedInAt: new Date("2026-04-06T14:12:00-04:00").getTime(),
            student: {
              displayName: "Naomi Adams",
              studentId: "10001",
            },
          },
          error: null,
          bootstrapError: null,
          isReady: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Naomi Adams" })).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.getByText("Mon Apr 6")).toBeInTheDocument();
    expect(screen.getByText("2:12 PM")).toBeInTheDocument();
    expect(screen.queryByText("Checked in")).not.toBeInTheDocument();
    expect(screen.queryByText("You are checked in")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance recorded successfully.")).not.toBeInTheDocument();
    expect(screen.queryByText("Homeroom")).not.toBeInTheDocument();
    expect(screen.queryByText("Grade 7 Homeroom")).not.toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-emerald-100");
    expect(container.querySelector(".max-w-md")).toBeNull();
  });

  it("renders a full-screen amber warning with the same large identity layout", () => {
    const { container } = render(
      <StudentCheckInScreen
        token="check-in-token"
        fixtureState={{
          context: {
            roster: { name: "Grade 7 Homeroom" },
            session: { title: "Homeroom", status: "open" },
          },
          result: {
            code: "review_needed",
            title: "Staff review is needed",
            description: "Ask staff to tap you in.",
            tone: "yellow",
            checkedInAt: new Date("2026-04-06T14:12:00-04:00").getTime(),
            student: {
              displayName: "Naomi Adams",
              studentId: "10001",
            },
          },
          error: null,
          bootstrapError: null,
          isReady: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Naomi Adams" })).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.getByText("Needs help")).toBeInTheDocument();
    expect(screen.getByText("Mon Apr 6")).toBeInTheDocument();
    expect(screen.getByText("2:12 PM")).toBeInTheDocument();
    expect(screen.queryByText("Staff review is needed")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask staff to tap you in.")).not.toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-amber-100");
  });

  it("renders a full-screen red failure with generic status text", () => {
    const { container } = render(
      <StudentCheckInScreen
        token="check-in-token"
        fixtureState={{
          context: {
            roster: { name: "Grade 7 Homeroom" },
            session: { title: "Homeroom", status: "open" },
          },
          result: {
            code: "not_on_roster",
            title: "You are not on this roster",
            description: "Ask staff to check you in manually.",
            tone: "red",
            checkedInAt: new Date("2026-04-06T14:12:00-04:00").getTime(),
            student: {
              displayName: "Naomi Adams",
              studentId: "10001",
            },
          },
          error: null,
          bootstrapError: null,
          isReady: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Naomi Adams" })).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.getByText("Check-in unsuccessful")).toBeInTheDocument();
    expect(screen.getByText("Mon Apr 6")).toBeInTheDocument();
    expect(screen.getByText("2:12 PM")).toBeInTheDocument();
    expect(screen.queryByText("You are not on this roster")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask staff to check you in manually.")).not.toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-rose-100");
  });

  it("keeps the quieter centered card for loading and invalid-link states", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { container } = render(<StudentCheckInScreen token="check-in-token" />);

    expect(screen.getByRole("heading", { name: "Checking you in" })).toBeInTheDocument();
    expect(container.querySelector(".max-w-md")).not.toBeNull();
    expect(container.querySelector("main")?.className).not.toContain("bg-emerald-100");
  });

  it("does not submit student check-in before attendance opens", () => {
    mockUseQuery.mockReturnValue({
      roster: { name: "Grade 7 Homeroom" },
      session: { title: "Homeroom", status: "not_open" },
    });
    mockUseCurrentAppUser.mockReturnValue({
      currentAppUser: { _id: "app-user-1" },
      isReady: true,
      bootstrapError: null,
    });

    render(<StudentCheckInScreen token="roster-share-token-1" />);

    expect(screen.getByRole("heading", { name: "Attendance is not open yet" })).toBeInTheDocument();
    expect(screen.getByText("Ask your teacher when check-in starts.")).toBeInTheDocument();
    expect(screen.getAllByText("Not open yet").length).toBeGreaterThan(0);
    expect(mockCheckIn).not.toHaveBeenCalled();
  });
});
