import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPikaAuthorizeUrl,
  buildPikaReturnUrl,
  pikaAuthHandoffInternals,
  safePikaReturnPath,
} from "./pika-auth-handoff";

describe("Pika authentication handoff contract", () => {
  beforeEach(() => {
    vi.stubEnv("PIKA_AUTH_BASE_URL", "https://pika.codepet.ca");
    vi.stubEnv("PIKA_BARA_HANDOFF_STATE_SECRET", "test-state-secret-with-at-least-32-characters");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps authorization and return URLs on the configured Pika origin", () => {
    expect(buildPikaAuthorizeUrl("a".repeat(43))).toBe(
      `https://pika.codepet.ca/api/auth/attendance/v1/authorize?state=${"a".repeat(43)}`,
    );
    expect(buildPikaReturnUrl("/classrooms/one?tab=attendance")).toBe(
      "https://pika.codepet.ca/classrooms/one?tab=attendance",
    );
    expect(buildPikaReturnUrl("/classrooms/one?tab=attendance", {
      attendanceAuth: "unavailable",
    })).toBe(
      "https://pika.codepet.ca/classrooms/one?tab=attendance&attendance_auth=unavailable",
    );
    expect(buildPikaReturnUrl("/attendance/check-in/token-123")).toBe(
      "https://pika.codepet.ca/attendance/check-in/token-123",
    );
    expect(safePikaReturnPath("https://evil.example")).toBe("/classrooms");
    expect(buildPikaReturnUrl("//evil.example")).toBe("https://pika.codepet.ca/classrooms");
  });

  it("rejects origins containing credentials or non-local HTTP", () => {
    vi.stubEnv("PIKA_AUTH_BASE_URL", "https://user@pika.codepet.ca");
    expect(() => buildPikaReturnUrl("/classrooms")).toThrow("not configured");

    vi.stubEnv("PIKA_AUTH_BASE_URL", "http://pika.codepet.ca");
    expect(() => buildPikaReturnUrl("/classrooms")).toThrow("not configured");

    vi.stubEnv("PIKA_AUTH_BASE_URL", "http://localhost:3000");
    expect(buildPikaReturnUrl("/classrooms")).toBe("http://localhost:3000/classrooms");
  });

  it("detects tampered state payloads", () => {
    const state = {
      nonce: "a".repeat(43),
      nextPath: "/classrooms",
      expiresAt: Date.now() + 60_000,
    };
    const sealed = pikaAuthHandoffInternals.sealState(state);

    expect(pikaAuthHandoffInternals.unsealState(sealed)).toEqual(state);
    expect(pikaAuthHandoffInternals.unsealState(`${sealed}tampered`)).toBeNull();
  });
});
