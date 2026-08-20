import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const HANDOFF_STATE_COOKIE = "bara_pika_auth_handoff";
const HANDOFF_STATE_MAX_AGE_SECONDS = 2 * 60;
const INTERNAL_PATH_BASE = "https://pika.internal";

interface PikaHandoffState {
  nonce: string;
  nextPath: string;
  expiresAt: number;
}

function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return false;

  try {
    return new URL(path, INTERNAL_PATH_BASE).origin === INTERNAL_PATH_BASE;
  } catch {
    return false;
  }
}

function configuredPikaOrigin(): string {
  const raw = process.env.PIKA_AUTH_BASE_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Pika authentication handoff is not configured.");
  }

  const localHttp =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Pika authentication handoff is not configured.");
  }

  return url.origin;
}

function stateSecret(): string {
  const secret = process.env.PIKA_BARA_HANDOFF_STATE_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("Pika authentication handoff is not configured.");
  }
  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", stateSecret()).update(encodedPayload).digest("base64url");
}

function sealState(state: PikaHandoffState): string {
  const encodedPayload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function unsealState(value: string): PikaHandoffState | null {
  const [encodedPayload, encodedSignature, ...rest] = value.split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) return null;

  const expected = Buffer.from(sign(encodedPayload));
  const received = Buffer.from(encodedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<PikaHandoffState>;
    if (
      typeof parsed.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(parsed.nonce) ||
      !isSafeInternalPath(parsed.nextPath) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }
    return {
      nonce: parsed.nonce,
      nextPath: parsed.nextPath.trim(),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function isPikaAuthHandoffEnabled() {
  return process.env.PIKA_BARA_AUTH_HANDOFF === "true";
}

export function safePikaReturnPath(value: unknown, fallback = "/classrooms") {
  return isSafeInternalPath(value) ? value.trim() : fallback;
}

export function buildPikaAuthorizeUrl(state: string) {
  const url = new URL("/api/auth/attendance/v1/authorize", configuredPikaOrigin());
  url.searchParams.set("state", state);
  return url.toString();
}

export function buildPikaReturnUrl(
  nextPath: string,
  options?: { attendanceAuth?: "unavailable" },
) {
  const url = new URL(safePikaReturnPath(nextPath), configuredPikaOrigin());
  if (options?.attendanceAuth === "unavailable") {
    url.searchParams.set("attendance_auth", "unavailable");
  }
  return url.toString();
}

export async function createPikaHandoffState(nextPath: unknown, now = Date.now()) {
  const state: PikaHandoffState = {
    nonce: randomBytes(32).toString("base64url"),
    nextPath: safePikaReturnPath(nextPath),
    expiresAt: now + HANDOFF_STATE_MAX_AGE_SECONDS * 1000,
  };
  const cookieStore = await cookies();
  cookieStore.set(HANDOFF_STATE_COOKIE, sealState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: HANDOFF_STATE_MAX_AGE_SECONDS,
    path: "/auth/pika/v1",
  });
  return state;
}

export async function consumePikaHandoffState(
  receivedNonce: unknown,
  now = Date.now(),
): Promise<PikaHandoffState | null> {
  const cookieStore = await cookies();
  const sealed = cookieStore.get(HANDOFF_STATE_COOKIE)?.value;
  cookieStore.set(HANDOFF_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/auth/pika/v1",
  });
  if (!sealed || typeof receivedNonce !== "string") return null;

  const state = unsealState(sealed);
  if (!state || state.expiresAt <= now || state.nonce !== receivedNonce) return null;
  return state;
}

export const pikaAuthHandoffInternals = {
  sealState,
  unsealState,
};
