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
    });
  });

  it("uses only the synthetic session token to render the enabled editor fixture", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = visualSessionFixture.session.checkInToken;

    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({
      token,
      fixtureSession: visualSessionFixture,
    });
  });


  it.each([
    visualSessionFixture.session.checkInToken,
  ])("keeps synthetic token %s on the normal query path when fixtures are disabled", async (token) => {
    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({ token });
  });

  it("keeps nonfixture tokens on the normal query path when fixtures are enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = "real-session-token";

    render(await EditorAttendancePage({ params: Promise.resolve({ token }) }));

    expect(sessionAttendanceScreenMock).toHaveBeenCalledWith({ token });
  });
});
