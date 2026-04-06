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

    expect(screen.getByText("Checked in")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Naomi Adams" })).toBeInTheDocument();
    expect(screen.getByText("You are checked in")).toBeInTheDocument();
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.getByText("Homeroom")).toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-emerald-100");
    expect(container.querySelector(".max-w-md")).toBeNull();
  });

  it("renders a full-screen amber warning when staff review is needed", () => {
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

    expect(screen.getByText("Needs help")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Naomi Adams" })).toBeInTheDocument();
    expect(screen.getByText("Staff review is needed")).toBeInTheDocument();
    expect(container.querySelector("main")?.className).toContain("bg-amber-100");
  });

  it("keeps the quieter centered card for loading and invalid-link states", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { container } = render(<StudentCheckInScreen token="check-in-token" />);

    expect(screen.getByRole("heading", { name: "Checking you in" })).toBeInTheDocument();
    expect(container.querySelector(".max-w-md")).not.toBeNull();
    expect(container.querySelector("main")?.className).not.toContain("bg-emerald-100");
  });
});
