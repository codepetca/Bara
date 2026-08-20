import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateWithCode: vi.fn(),
  saveSession: vi.fn(),
  bootstrapCurrentAppUser: vi.fn(),
  consumeState: vi.fn(),
  buildReturnUrl: vi.fn((path: string, options?: { attendanceAuth?: string }) => {
    const url = new URL(path, "https://pika.codepet.ca");
    if (options?.attendanceAuth === "unavailable") {
      url.searchParams.set("attendance_auth", "unavailable");
    }
    return url.toString();
  }),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({
    userManagement: { authenticateWithCode: mocks.authenticateWithCode },
  }),
  saveSession: mocks.saveSession,
}));
vi.mock("@/lib/pika-auth-handoff", () => ({
  isPikaAuthHandoffEnabled: () => process.env.PIKA_BARA_AUTH_HANDOFF === "true",
  consumePikaHandoffState: mocks.consumeState,
  buildPikaReturnUrl: mocks.buildReturnUrl,
}));
vi.mock("@/lib/server/bootstrap-current-app-user", () => ({
  bootstrapCurrentAppUser: mocks.bootstrapCurrentAppUser,
}));

import { GET } from "./route";

function request() {
  return new NextRequest(
    "https://attendance.example/auth/pika/v1/callback?code=authkit_authz_code_1&state=nonce",
    { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1", "user-agent": "Test browser" } },
  );
}

describe("GET /auth/pika/v1/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PIKA_BARA_AUTH_HANDOFF", "true");
    vi.stubEnv("WORKOS_CLIENT_ID", "client_attendance_test");
    mocks.consumeState.mockResolvedValue({
      nonce: "nonce",
      nextPath: "/attendance/check-in/token-123",
    });
    mocks.authenticateWithCode.mockResolvedValue({
      user: { id: "workos-user-1", emailVerified: true },
      accessToken: "attendance-access-token",
      refreshToken: "attendance-refresh-token",
    });
    mocks.bootstrapCurrentAppUser.mockResolvedValue({ _id: "app_user_one" });
  });

  it("exchanges the single-use code for an application-scoped session and returns to Pika", async () => {
    const req = request();
    const response = await GET(req);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pika.codepet.ca/attendance/check-in/token-123",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.consumeState).toHaveBeenCalledWith("nonce");
    expect(mocks.authenticateWithCode).toHaveBeenCalledWith({
      clientId: "client_attendance_test",
      code: "authkit_authz_code_1",
      ipAddress: "203.0.113.10",
      userAgent: "Test browser",
    });
    expect(mocks.bootstrapCurrentAppUser).toHaveBeenCalledWith("attendance-access-token");
    expect(mocks.saveSession).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "attendance-access-token",
    }), req);
    expect(mocks.bootstrapCurrentAppUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveSession.mock.invocationCallOrder[0],
    );
    expect(mocks.buildReturnUrl).toHaveBeenCalledWith("/attendance/check-in/token-123");
  });

  it("rejects state mismatch or replay before contacting WorkOS", async () => {
    mocks.consumeState.mockResolvedValue(null);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it("returns to Pika without a second login when WorkOS rejects the code", async () => {
    mocks.authenticateWithCode.mockRejectedValue(new Error("provider detail"));
    const response = await GET(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pika.codepet.ca/attendance/check-in/token-123?attendance_auth=unavailable",
    );
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it("does not save a session when Convex cannot verify and bootstrap the identity", async () => {
    mocks.bootstrapCurrentAppUser.mockRejectedValue(new Error("JWT audience mismatch"));
    const response = await GET(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pika.codepet.ca/attendance/check-in/token-123?attendance_auth=unavailable",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });
});
