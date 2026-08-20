type ContentSecurityPolicyOptions = {
  nonce: string;
  isDevelopment: boolean;
  convexUrls?: Array<string | undefined>;
};

function connectSources(values: Array<string | undefined>) {
  const sources = new Set<string>();

  for (const value of values) {
    if (!value) continue;

    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;

      sources.add(url.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      sources.add(url.origin);
    } catch {
      // Invalid optional URLs are rejected elsewhere by environment preflight.
    }
  }

  return [...sources];
}

export function createContentSecurityPolicy({
  nonce,
  isDevelopment,
  convexUrls = [],
}: ContentSecurityPolicyOptions) {
  const connections = [
    "'self'",
    ...connectSources(convexUrls),
    ...(isDevelopment ? ["ws://127.0.0.1:*", "ws://localhost:*"] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src ${connections.join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}
