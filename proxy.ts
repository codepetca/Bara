import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextRequest } from "next/server";
import { createContentSecurityPolicy } from "@/lib/server/content-security-policy";

export function isProtectedRoute(pathname: string) {
  return pathname === "/" || pathname.startsWith("/rosters") || pathname.startsWith("/check-in/");
}

export default async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = createContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    convexUrls: [process.env.NEXT_PUBLIC_CONVEX_URL, process.env.NEXT_PUBLIC_CONVEX_SITE_URL],
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const securedRequest = new NextRequest(request, { headers: requestHeaders });

  const { session, headers, authorizationUrl } = await authkit(securedRequest, {
    eagerAuth: true,
  });

  let response;
  if (isProtectedRoute(request.nextUrl.pathname) && !session.user && authorizationUrl) {
    response = handleAuthkitHeaders(securedRequest, headers, { redirect: authorizationUrl });
  } else {
    response = handleAuthkitHeaders(securedRequest, headers);
  }

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
