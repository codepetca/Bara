import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/api";
import { createV1RequestSignature } from "@/lib/attendance-contract/v1/signing";
import { displayPairingBeginPath, displayPairingHashPattern } from "@/lib/display-pairing";

function pairingNetwork(request: Request) {
  const forwarded = process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for")?.trim() ?? ""
    : process.env.NODE_ENV !== "production" ? "127.0.0.1" : "";
  const family = isIP(forwarded);
  if (family === 4) return forwarded;
  if (family !== 6 || forwarded.includes("%")) return null;
  // Normalize before grouping IPv6 privacy addresses on the same /64.
  const normalized = new URL(`http://[${forwarded}]/`).hostname.slice(1, -1);
  const [left, right] = normalized.split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const parts = right === undefined ? start : [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end];
  // IPv4-mapped IPv6 addresses share the original IPv4 budget.
  if (parts.slice(0, 6).join(":") === "0:0:0:0:0:ffff") {
    const upper = Number.parseInt(parts[6], 16);
    const lower = Number.parseInt(parts[7], 16);
    return [upper >> 8, upper & 255, lower >> 8, lower & 255].join(".");
  }
  return parts.slice(0, 4).join(":");
}

const response = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response(403);
  // The only accepted body is a lowercase SHA-256 digest.
  if (Number(request.headers.get("content-length")) > 64) return response(400);
  const reader = request.body?.getReader();
  if (!reader) return response(400);
  const decoder = new TextDecoder();
  let credentialHash = "";
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 64) { void reader.cancel(); return response(400); }
    credentialHash += decoder.decode(value);
  }
  if (!displayPairingHashPattern.test(credentialHash)) return response(400);

  const secret = process.env.BARA_DISPLAY_PAIRING_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const network = pairingNetwork(request);
  if (!secret || secret.length < 32 || !url || !network) return response(503);

  const source = createHmac("sha256", secret).update(`bara-display-network\n${network}`).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await createV1RequestSignature({
    secret, method: "POST", path: displayPairingBeginPath, timestamp, nonce: source, body: credentialHash,
  });
  try {
    const client = new ConvexHttpClient(url, {
      logger: false,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000), cache: "no-store" }),
    });
    const result = await client.mutation(api.displayPairing.begin, { credentialHash, source, timestamp, signature });
    return response(result === "ready" ? 204 : result === "rate_limited" ? 429 : 503);
  } catch {
    return response(503);
  }
}
