import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SharedDisplayPage from "./page";

const sessionDisplayScreenMock = vi.fn();

vi.mock("@/components/session-display-screen", () => ({
  SessionDisplayScreen: (props: unknown) => {
    sessionDisplayScreenMock(props);
    return <div>Shared attendance display</div>;
  },
}));

describe("SharedDisplayPage", () => {
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
});
