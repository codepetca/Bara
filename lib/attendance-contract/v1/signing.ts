const SIGNATURE_PREFIX = "v1=";
const HEX_SIGNATURE = /^[a-f0-9]{64}$/;

export interface V1SigningInput {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function canonicalRequest(input: V1SigningInput) {
  if (input.secret.length < 32) throw new Error("Integration signing secret must be at least 32 characters.");
  if (!/^[A-Z]+$/.test(input.method)) throw new Error("Integration request method must be uppercase.");
  if (!input.path.startsWith("/") || input.path.includes("?") || input.path.includes("#")) {
    throw new Error("Integration request path must be an absolute pathname.");
  }
  if (!/^\d{10}$/.test(input.timestamp)) throw new Error("Integration timestamp must use Unix seconds.");
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(input.nonce)) throw new Error("Integration nonce is invalid.");

  return ["pika-attendance-v1", input.method, input.path, input.timestamp, input.nonce, input.body].join("\n");
}

async function hmacKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function createV1RequestSignature(input: V1SigningInput) {
  const canonical = canonicalRequest(input);
  const key = await hmacKey(input.secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return `${SIGNATURE_PREFIX}${bytesToHex(new Uint8Array(signature))}`;
}

export async function verifyV1RequestSignature(input: V1SigningInput, signature: unknown) {
  if (typeof signature !== "string" || !signature.startsWith(SIGNATURE_PREFIX)) return false;
  const hex = signature.slice(SIGNATURE_PREFIX.length);
  if (!HEX_SIGNATURE.test(hex)) return false;

  const canonical = canonicalRequest(input);
  const key = await hmacKey(input.secret, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(hex),
    new TextEncoder().encode(canonical),
  );
}
