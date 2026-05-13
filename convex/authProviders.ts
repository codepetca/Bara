import type { UserIdentity } from "convex/server";
import { v } from "convex/values";

export const authProviderValidator = v.string();

const PROVIDER_ISSUER_MAP_ENV = "TAPCHECK_AUTH_PROVIDER_ISSUER_MAP";
const KNOWN_PROVIDER_KEYS = new Set(["workos", "supabase", "pika"]);

function normalizeIssuer(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function providerKeyFromValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function parseProviderIssuerMap() {
  const raw = process.env[PROVIDER_ISSUER_MAP_ENV];
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => {
      const [provider, ...issuerParts] = entry.split("=");
      const issuer = issuerParts.join("=");
      if (!provider || !issuer) {
        return null;
      }

      const providerKey = providerKeyFromValue(provider);
      if (!providerKey) {
        return null;
      }

      return {
        provider: providerKey,
        issuer: normalizeIssuer(issuer),
      };
    })
    .filter((entry): entry is { provider: string; issuer: string } => entry !== null);
}

function getConfiguredProviderIssuers() {
  const configured = parseProviderIssuerMap();
  const workosClientId = process.env.WORKOS_CLIENT_ID?.trim();

  if (workosClientId) {
    configured.push(
      {
        provider: "workos",
        issuer: normalizeIssuer(`https://api.workos.com/user_management/${workosClientId}`),
      },
      {
        provider: "workos",
        issuer: normalizeIssuer("https://api.workos.com/"),
      },
    );
  }

  return configured;
}

function inferProviderFromIssuer(issuer: string) {
  if (!issuer) {
    return null;
  }

  let host = issuer;
  try {
    host = new URL(issuer).hostname;
  } catch {
    // The Convex identity should provide a URL issuer, but tests and future
    // adapters may pass compact issuer keys.
  }

  const normalizedHost = host.toLocaleLowerCase();
  if (normalizedHost.includes("workos") || normalizedHost.includes("authkit")) {
    return "workos";
  }
  if (normalizedHost.endsWith("supabase.co") || normalizedHost.includes(".supabase.")) {
    return "supabase";
  }
  if (normalizedHost.includes("pika")) {
    return "pika";
  }

  const hostKey = providerKeyFromValue(normalizedHost);
  return hostKey ? `oidc_${hostKey}` : null;
}

function inferProviderFromSubject(subject: string) {
  const prefix = subject.split(/[:|]/)[0];
  if (!prefix) {
    return null;
  }

  const providerKey = providerKeyFromValue(prefix);
  return KNOWN_PROVIDER_KEYS.has(providerKey) ? providerKey : null;
}

export function getAuthProvider(identity: Pick<UserIdentity, "issuer" | "subject">) {
  const issuer = normalizeIssuer(identity.issuer ?? "");
  const configured = getConfiguredProviderIssuers().find((entry) => entry.issuer === issuer);
  if (configured) {
    return configured.provider;
  }

  return inferProviderFromIssuer(issuer) ?? inferProviderFromSubject(identity.subject) ?? "oidc";
}
