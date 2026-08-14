import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

export function isProtectedRoute(pathname: string) {
  return pathname === "/" || pathname.startsWith("/rosters") || pathname.startsWith("/check-in/");
}

export default async function proxy(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);

  if (isProtectedRoute(request.nextUrl.pathname) && !session.user && authorizationUrl) {
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
