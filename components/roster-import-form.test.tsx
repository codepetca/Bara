import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RosterImportForm } from "./roster-import-form";

const mockImportCsv = vi.fn();
const mockImportIntoExisting = vi.fn();
const mockUseCurrentAppUser = vi.fn();
const mockUseMutation = vi.fn();
const mockUseQuery = vi.fn();
const mockPush = vi.fn();
let mutationHookCallCount = 0;

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/use-current-app-user", () => ({
  useCurrentAppUser: () => mockUseCurrentAppUser(),
}));

describe("RosterImportForm", () => {
  beforeEach(() => {
    mutationHookCallCount = 0;
    mockImportCsv.mockReset();
    mockImportIntoExisting.mockReset();
    mockUseCurrentAppUser.mockReset();
    mockUseMutation.mockReset();
    mockUseQuery.mockReset();
    mockPush.mockReset();

    mockUseCurrentAppUser.mockReturnValue({
      bootstrapError: null,
      isReady: true,
    });
    mockImportCsv.mockResolvedValue("roster-123");
    mockUseMutation.mockImplementation(() =>
      mutationHookCallCount++ % 2 === 0 ? mockImportCsv : mockImportIntoExisting,
    );
    mockUseQuery.mockReturnValue(null);
  });

  it("uses the roster title label and hides the title column selector for CSV imports", async () => {
    const { container } = render(<RosterImportForm />);

    const csvContents = [
      "Student ID,Student Name,Course Name",
      "1001,John Smith,Period 1 Homeroom",
      "1002,Maya Jones,Period 1 Homeroom",
    ].join("\n");
    const file = new File([csvContents], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(csvContents),
    });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("Title")).toBeInTheDocument();
    });

    expect(screen.queryByText("Roster title column")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Period 1 Homeroom")).toBeInTheDocument();
    expect(screen.queryByText(/Inferred roster title:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rows parsed/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Name column")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create roster/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Import settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /Supported CSV formats/i }));

    expect(screen.getByText("Name column")).toBeInTheDocument();
    expect(screen.getByText("Student ID column")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Student2/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/CSV can be many formats including entire SchoolCash Online CSV files\./i)).toBeInTheDocument();
  });

  it("shows paste list help in a modal", () => {
    render(<RosterImportForm />);

    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.click(screen.getByRole("button", { name: /Paste list help/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Paste or type student ID and name")).toBeInTheDocument();
  });

  it("accepts email-only CSV imports", async () => {
    const { container } = render(<RosterImportForm />);

    const csvContents = ["Student Name,School Email", "Stewart Chan,stew.chan@example.edu"].join("\n");

    const file = new File([csvContents], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(csvContents),
    });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("School email column")).toBeInTheDocument();
    });

    expect(screen.queryByRole("columnheader", { name: "School Email" })).not.toBeInTheDocument();
    expect(screen.getByText(/Choose at least one identifier column/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("School email column"), {
      target: { value: "School Email" },
    });

    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "School Email" })).toBeInTheDocument();
      expect(screen.getByText("stew.chan@example.edu")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Choose at least one identifier column/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create roster/i })).toBeEnabled();
  });

  it("does not import school email from CSV unless the email column is selected", async () => {
    const { container } = render(<RosterImportForm />);

    const csvContents = [
      "Student ID,Student Name,School Email,Course Name",
      "1001,John Smith,payment-contact@example.com,Period 1 Homeroom",
    ].join("\n");
    const file = new File([csvContents], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(csvContents),
    });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getAllByText("John Smith").length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("columnheader", { name: "School Email" })).not.toBeInTheDocument();
    expect(screen.queryByText("payment-contact@example.com")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create roster/i }));

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith({
        name: "Period 1 Homeroom",
        students: [
          expect.objectContaining({
            studentId: "1001",
            schoolEmail: undefined,
            rawName: "John Smith",
            displayName: "John Smith",
          }),
        ],
      });
    });

    expect(JSON.stringify(mockImportCsv.mock.calls[0]?.[0] ?? {})).not.toContain("payment-contact@example.com");
  });

  it("strips email addresses from imported student names before creating the roster", async () => {
    const { container } = render(<RosterImportForm />);

    const csvContents = [
      "Student ID,Student Name,Course Name",
      '1001,"Smith, John <john@example.com>",Period 1 Homeroom',
      "1002,Maya Jones maya@example.com,Period 1 Homeroom",
    ].join("\n");
    const file = new File([csvContents], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(csvContents),
    });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("John Smith")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Create roster/i }));

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith({
        name: "Period 1 Homeroom",
        students: [
          expect.objectContaining({
            studentId: "1001",
            rawName: "Smith, John",
            firstName: "John",
            lastName: "Smith",
            displayName: "John Smith",
          }),
          expect.objectContaining({
            studentId: "1002",
            rawName: "Maya Jones",
            firstName: "Maya",
            lastName: "Jones",
            displayName: "Maya Jones",
          }),
        ],
      });
    });

    expect(JSON.stringify(mockImportCsv.mock.calls[0]?.[0] ?? {})).not.toContain("@example.com");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/rosters/roster-123");
    });
  });

  it("lets a teacher create a managed schedule during roster setup", async () => {
    render(<RosterImportForm />);

    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.change(screen.getByLabelText("Paste student list"), {
      target: { value: "1001\tAlice Able\n1002\tBen Baker" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Recurring/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Recurring/i }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-04-09" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-06-27" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:35" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "10:50" } });
    fireEvent.click(screen.getByRole("button", { name: /Options/i }));
    fireEvent.change(screen.getByLabelText("Open minutes early"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Create roster/i }));

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith({
        name: expect.any(String),
        students: [
          expect.objectContaining({ studentId: "1001", displayName: "Alice Able" }),
          expect.objectContaining({ studentId: "1002", displayName: "Ben Baker" }),
        ],
        managedSchedule: expect.objectContaining({
          startDate: "2026-04-09",
          endDate: "2026-06-27",
          weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          startMinutes: 575,
          endMinutes: 650,
          autoOpen: true,
          autoOpenOffsetMinutes: 3,
          autoCloseOffsetMinutes: 5,
          autoCloseGraceMinutes: 10,
          active: true,
        }),
      });
    });
  });

  it("defaults recurring dates to today and the next day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00-04:00"));

    try {
      render(<RosterImportForm />);

      fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
      fireEvent.change(screen.getByLabelText("Paste student list"), {
        target: { value: "1001\tAlice Able" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Recurring/i }));

      expect(screen.getByLabelText("Start date")).toHaveValue("2026-04-10");
      expect(screen.getByLabelText("End date")).toHaveValue("2026-04-11");
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates single attendance from the wizard from the students step", async () => {
    render(<RosterImportForm variant="wizard" />);

    expect(screen.getByText("Step 1 · Attendance type")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Attendance/i })).not.toBeInTheDocument();
    expect(screen.getByText("Start with a reusable one-off class and open attendance manually whenever you need it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.change(screen.getByLabelText("Paste student list"), {
      target: { value: "1001\tAlice Able\n1002\tBen Baker" },
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Period 1 Homeroom")).toBeInTheDocument();
    });

    expect(mockImportCsv).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Create Attendance/i }));

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith({
        name: expect.any(String),
        students: [
          expect.objectContaining({ studentId: "1001", displayName: "Alice Able" }),
          expect.objectContaining({ studentId: "1002", displayName: "Ben Baker" }),
        ],
      });
    });
  });

  it("creates recurring attendance from the wizard with the default schedule", async () => {
    render(<RosterImportForm variant="wizard" />);

    fireEvent.click(screen.getByRole("button", { name: /Recurring/i }));
    expect(screen.getByText("Set up a repeating class with sensible defaults, then fine-tune the rest in options.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.change(screen.getByLabelText("Paste student list"), {
      target: { value: "1001\tAlice Able" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Attendance/i }));

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith({
        name: expect.any(String),
        students: [expect.objectContaining({ studentId: "1001", displayName: "Alice Able" })],
        managedSchedule: expect.objectContaining({
          weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          startMinutes: 490,
          endMinutes: 570,
          autoOpen: true,
          autoOpenOffsetMinutes: 5,
          autoCloseOffsetMinutes: 5,
          autoCloseGraceMinutes: 10,
          active: true,
        }),
      });
    });
  });

  it("does not restore wizard progress after unmounting", async () => {
    const { unmount } = render(<RosterImportForm variant="wizard" />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.change(screen.getByLabelText("Paste student list"), {
      target: { value: "1001\tAlice Able" },
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Period 1 Homeroom")).toBeInTheDocument();
    });

    unmount();

    render(<RosterImportForm variant="wizard" />);

    expect(screen.getByText("Step 1 · Attendance type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Paste student list")).not.toBeInTheDocument();
  });

  it("does not allow create attendance from step 1 even after students were added", async () => {
    render(<RosterImportForm variant="wizard" />);

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Paste list/i }));
    fireEvent.change(screen.getByLabelText("Paste student list"), {
      target: { value: "1001\tAlice Able" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Create Attendance/i })).toBeInTheDocument();
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Back/i }));

    expect(screen.getByText("Step 1 · Attendance type")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
  });
});
