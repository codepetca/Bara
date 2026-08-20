import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/api";

function convexDeploymentUrl() {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Convex authentication is not configured.");
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
    throw new Error("Convex authentication is not configured.");
  }

  return url.origin;
}

export async function bootstrapCurrentAppUser(accessToken: string) {
  if (!accessToken.trim()) {
    throw new Error("WorkOS authentication did not return an access token.");
  }

  const client = new ConvexHttpClient(convexDeploymentUrl(), {
    auth: accessToken,
    logger: false,
  });
  return client.mutation(api.appUsers.ensureCurrent, {});
}
