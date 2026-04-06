import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EditorAttendancePage from "./page";

const sessionAttendanceScreenMock = vi.fn();

vi.mock("@/components/session-attendance-screen", () => ({
  SessionAttendanceScreen: (props: unknown) => {
    sessionAttendanceScreenMock(props);
    return <div>Shared attendance editor</div>;
  },
}));

describe("EditorAttendancePage", () => {
  it("renders the shared attendance editor using the token route contract", async () => {
    const page = await EditorAttendancePage({
      params: Promise.resolve({ token: "editor-token-1" }),
    });

    render(page);

    expect(screen.getByText("Shared attendance editor")).toBeInTheDocument();
    expect(sessionAttendanceScreenMock).toHaveBeenCalledTimes(1);
    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({
      token: "editor-token-1",
      hideAuthControls: true,
    });
  });
});
