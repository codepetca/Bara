import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_CALLBACK_URL, getAuthCallbackUrl, SIGN_IN_URL, SIGN_UP_URL } from "@/lib/auth-routes";
import { getWorkosEnvStatus, WORKOS_SETUP_URL } from "@/lib/workos-config";

function isProtectedRoute(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/attendance") ||
    pathname.startsWith("/check-in") ||
    pathname.startsWith("/rosters")
  );
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === WORKOS_SETUP_URL) {
    return NextResponse.next();
  }

  if (!getWorkosEnvStatus().isReady) {
    return NextResponse.redirect(new URL(WORKOS_SETUP_URL, request.url));
  }

  if (pathname === SIGN_IN_URL || pathname === SIGN_UP_URL || pathname === AUTH_CALLBACK_URL) {
    return NextResponse.next();
  }

  const { headers, session, authorizationUrl } = await authkit(request, {
    redirectUri: getAuthCallbackUrl(request.url),
  });

  if (isProtectedRoute(pathname) && !session.user && authorizationUrl) {
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
