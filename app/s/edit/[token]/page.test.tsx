import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visualSessionFixture } from "@/lib/visual-fixtures";
import EditorAttendancePage from "./page";

const sessionAttendanceScreenMock = vi.fn();

vi.mock("@/components/session-attendance-screen", () => ({
  SessionAttendanceScreen: (props: unknown) => {
    sessionAttendanceScreenMock(props);
    return <div>Shared attendance editor</div>;
  },
}));

describe("EditorAttendancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("uses only the synthetic staff token to render the enabled editor fixture", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = visualSessionFixture.session.staffShareToken;

    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({
      token,
      hideAuthControls: true,
      fixtureSession: visualSessionFixture,
    });
  });

  it("rejects the synthetic student token on the enabled staff fixture route", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");

    await expect(EditorAttendancePage({
      params: Promise.resolve({ token: visualSessionFixture.session.checkInToken }),
    })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(sessionAttendanceScreenMock).not.toHaveBeenCalled();
  });

  it.each([
    visualSessionFixture.session.staffShareToken,
    visualSessionFixture.session.checkInToken,
  ])("keeps synthetic token %s on the normal query path when fixtures are disabled", async (token) => {
    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({ token, hideAuthControls: true });
  });

  it("keeps nonfixture tokens on the normal query path when fixtures are enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = "real-staff-token";

    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({ token, hideAuthControls: true });
  });
});
