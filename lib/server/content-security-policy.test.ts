import { describe, expect, it } from "vitest";
import { createContentSecurityPolicy } from "./content-security-policy";

describe("createContentSecurityPolicy", () => {
  it("creates a strict production policy scoped to configured Convex origins", () => {
    const policy = createContentSecurityPolicy({
      nonce: "nonce-value",
      isDevelopment: false,
      convexUrls: [
        "https://example.convex.cloud/path",
        "https://example.convex.site",
        "not-a-url",
      ],
    });

    expect(policy).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain(
      "connect-src 'self' https://example.convex.cloud wss://example.convex.cloud https://example.convex.site wss://example.convex.site",
    );
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("not-a-url");
  });

  it("allows only the development runtime exceptions needed for local debugging", () => {
    const policy = createContentSecurityPolicy({
      nonce: "dev-nonce",
      isDevelopment: true,
    });

    expect(policy).toContain("script-src 'self' 'nonce-dev-nonce' 'strict-dynamic' 'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
