import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createState: vi.fn(),
  buildAuthorizeUrl: vi.fn(() => "https://pika.codepet.ca/api/auth/attendance/v1/authorize?state=nonce"),
}));

vi.mock("@/lib/pika-auth-handoff", () => ({
  isPikaAuthHandoffEnabled: () => process.env.PIKA_BARA_AUTH_HANDOFF === "true",
  createPikaHandoffState: mocks.createState,
  buildPikaAuthorizeUrl: mocks.buildAuthorizeUrl,
}));

import { GET } from "./route";

describe("GET /auth/pika/v1/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PIKA_BARA_AUTH_HANDOFF", "true");
    mocks.createState.mockResolvedValue({
      nonce: "a".repeat(43),
      nextPath: "/attendance/check-in/token-123",
    });
  });

  it("binds the requested Pika path to browser state before leaving the attendance app", async () => {
    const response = await GET(new NextRequest(
      "https://attendance.example/auth/pika/v1/start?next=%2Fattendance%2Fcheck-in%2Ftoken-123",
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pika.codepet.ca/api/auth/attendance/v1/authorize?state=nonce",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.createState).toHaveBeenCalledWith("/attendance/check-in/token-123");
    expect(mocks.buildAuthorizeUrl).toHaveBeenCalledWith("a".repeat(43));
  });

  it("is unavailable while the handoff flag is disabled", async () => {
    vi.stubEnv("PIKA_BARA_AUTH_HANDOFF", "false");
    const response = await GET(new NextRequest("https://attendance.example/auth/pika/v1/start"));

    expect(response.status).toBe(404);
    expect(mocks.createState).not.toHaveBeenCalled();
  });
});
