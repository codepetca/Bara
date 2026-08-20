import {
  sha256Hex,
  verifyV1RequestSignature,
} from "../lib/attendance-contract/v1/signing";

const MAX_BODY_BYTES = 512_000;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function jsonResponse(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function integrationConfiguration() {
  if (process.env.PIKA_ATTENDANCE_INTEGRATION !== "true") return null;
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  const secret = process.env.PIKA_INTEGRATION_SECRET ?? "";
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef) || secret.length < 32) {
    throw new Error("Pika attendance integration is not configured.");
  }
  return { installationRef, secret };
}

export async function authenticatePikaRequest(request: Request) {
  let configuration;
  try {
    configuration = integrationConfiguration();
  } catch {
    return {
      ok: false as const,
      response: jsonResponse(503, { ok: false, error: "temporarily_unavailable" }),
    };
  }
  if (!configuration) {
    return { ok: false as const, response: jsonResponse(404, { ok: false, error: "not_found" }) };
  }

  const url = new URL(request.url);
  if (url.search) {
    return { ok: false as const, response: jsonResponse(404, { ok: false, error: "not_found" }) };
  }
  if (!request.headers.get("content-type")?.toLocaleLowerCase().startsWith("application/json")) {
    return {
      ok: false as const,
      response: jsonResponse(415, { ok: false, error: "unsupported_media_type" }),
    };
  }

  const installationRef = request.headers.get("x-attendance-installation-ref")?.trim() ?? "";
  const timestamp = request.headers.get("x-attendance-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-attendance-nonce")?.trim() ?? "";
  const signature = request.headers.get("x-attendance-signature")?.trim() ?? "";
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    installationRef !== configuration.installationRef ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS ||
    !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)
  ) {
    return {
      ok: false as const,
      response: jsonResponse(401, { ok: false, error: "invalid_authentication" }),
    };
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return {
      ok: false as const,
      response: jsonResponse(413, { ok: false, error: "payload_too_large" }),
    };
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyV1RequestSignature(
      {
        secret: configuration.secret,
        method: request.method.toLocaleUpperCase(),
        path: url.pathname,
        timestamp,
        nonce,
        body,
      },
      signature,
    );
  } catch {
    return {
      ok: false as const,
      response: jsonResponse(503, { ok: false, error: "temporarily_unavailable" }),
    };
  }
  if (!signatureValid) {
    return {
      ok: false as const,
      response: jsonResponse(401, { ok: false, error: "invalid_authentication" }),
    };
  }

  return {
    ok: true as const,
    url,
    body,
    bodyDigest: await sha256Hex(body),
    installationRef,
    timestampSeconds,
    nonce,
  };
}
