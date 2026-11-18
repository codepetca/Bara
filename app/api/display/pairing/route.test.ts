// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyV1RequestSignature } from "@/lib/attendance-contract/v1/signing";
import { displayPairingBeginPath } from "@/lib/display-pairing";
import { POST } from "./route";

const mutation = vi.hoisted(() => vi.fn());
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class { mutation = mutation; },
}));

const origin = "https://bara.example";
const secret = "test-only-route-display-pairing-secret";
const hash = "a".repeat(64);

function request(ip: string, body = hash, requestOrigin = origin) {
  return new Request(origin + displayPairingBeginPath, {
    method: "POST",
    headers: { origin: requestOrigin, "x-vercel-forwarded-for": ip, "x-forwarded-for": "192.0.2.200" },
    body,
  });
}

describe("room display pairing ingress", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("BARA_DISPLAY_PAIRING_SECRET", secret);
    mutation.mockReset().mockResolvedValue("ready");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs a credential digest and groups addresses from the same network", async () => {
    expect((await POST(request("2001:db8:a:b::1"))).status).toBe(204);
    expect((await POST(request("2001:0db8:000a:000b:1234:0:0:2"))).status).toBe(204);
    expect((await POST(request("2001:db8:a:c::1"))).status).toBe(204);
    const [[, first], [, same], [, other]] = mutation.mock.calls;
    expect(first.source).toBe(same.source);
    expect(first.source).not.toBe(other.source);
    expect(first.credentialHash).toBe(hash);
    expect(first.source).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyV1RequestSignature({
      secret, method: "POST", path: displayPairingBeginPath, timestamp: first.timestamp, nonce: first.source, body: first.credentialHash,
    }, first.signature)).toBe(true);
  });

  it("rejects cross-origin, oversized and untrusted forwarding before Convex", async () => {
    expect((await POST(request("192.0.2.2", hash, "https://other.example"))).status).toBe(403);
    expect((await POST(request("192.0.2.2", hash + "b"))).status).toBe(400);
    expect((await POST(request("192.0.2.2, 192.0.2.3"))).status).toBe(503);
    expect((await POST(request(""))).status).toBe(503);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("reports an exhausted source without leaking its key", async () => {
    mutation.mockResolvedValue("rate_limited");
    const result = await POST(request("192.0.2.2"));
    expect(result.status).toBe(429);
    expect(await result.text()).toBe("");
  });
});
