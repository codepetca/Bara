import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getAuthCallbackUrl, getSafeReturnTo } from "@/lib/auth-routes";

export async function GET(request: NextRequest) {
  const returnTo = getSafeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const signInUrl = await getSignInUrl({
    ...(returnTo ? { returnTo } : {}),
    redirectUri: getAuthCallbackUrl(request.url),
  });

  return redirect(signInUrl);
}
