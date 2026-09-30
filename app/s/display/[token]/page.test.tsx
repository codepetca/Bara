import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visualDisplayFixture, visualSessionFixture } from "@/lib/visual-fixtures";
import SharedDisplayPage from "./page";

const sessionDisplayScreenMock = vi.fn();

vi.mock("@/components/session-display-screen", () => ({
  SessionDisplayScreen: (props: unknown) => {
    sessionDisplayScreenMock(props);
    return <div>Shared attendance display</div>;
  },
}));

describe("SharedDisplayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the shared QR display using the token route contract", async () => {
    const page = await SharedDisplayPage({
      params: Promise.resolve({ token: "display-token-1" }),
    });

    render(page);

    expect(screen.getByText("Shared attendance display")).toBeInTheDocument();
    expect(sessionDisplayScreenMock).toHaveBeenCalledTimes(1);
    expect(sessionDisplayScreenMock).toHaveBeenCalledWith({
      token: "display-token-1",
    });
  });

  it("uses only the synthetic staff token to render the enabled display fixture", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = visualSessionFixture.session.staffShareToken;

    render(await SharedDisplayPage({ params: Promise.resolve({ token }) }));

    expect(sessionDisplayScreenMock).toHaveBeenCalledWith({
      token,
      fixtureDisplay: visualDisplayFixture,
    });
    expect(visualDisplayFixture.displayContext.checkInToken).toBe(visualSessionFixture.session.checkInToken);
    expect(visualDisplayFixture.liveSession).toEqual({ counts: visualSessionFixture.counts });
  });

  it("rejects the synthetic student token on the enabled staff fixture route", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");

    await expect(SharedDisplayPage({
      params: Promise.resolve({ token: visualSessionFixture.session.checkInToken }),
    })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(sessionDisplayScreenMock).not.toHaveBeenCalled();
  });

  it.each([
    visualSessionFixture.session.staffShareToken,
    visualSessionFixture.session.checkInToken,
  ])("keeps synthetic token %s on the normal query path when fixtures are disabled", async (token) => {
    render(await SharedDisplayPage({ params: Promise.resolve({ token }) }));

    expect(sessionDisplayScreenMock).toHaveBeenCalledWith({ token });
  });

  it("keeps nonfixture tokens on the normal query path when fixtures are enabled", async () => {
    vi.stubEnv("ENABLE_VISUAL_TEST_ROUTES", "1");
    const token = "real-staff-token";

    render(await SharedDisplayPage({ params: Promise.resolve({ token }) }));

    expect(sessionDisplayScreenMock).toHaveBeenCalledWith({ token });
  });
});
