import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import {
  buildPikaReturnUrl,
  consumePikaHandoffState,
  isPikaAuthHandoffEnabled,
} from "@/lib/pika-auth-handoff";
import { bootstrapCurrentAppUser } from "@/lib/server/bootstrap-current-app-user";

export const runtime = "nodejs";

function returnToPikaUnavailable(nextPath: string) {
  return NextResponse.redirect(
    buildPikaReturnUrl(nextPath, { attendanceAuth: "unavailable" }),
    {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function requestContext(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.slice(0, 512).trim();
  return {
    ...(forwardedFor || realIp ? { ipAddress: forwardedFor || realIp } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

export async function GET(request: NextRequest) {
  if (!isPikaAuthHandoffEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  let state;
  try {
    state = await consumePikaHandoffState(request.nextUrl.searchParams.get("state"));
  } catch {
    return new NextResponse("Authentication handoff is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!state || !code) {
    return new NextResponse("Authentication handoff is invalid or expired.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (code.length > 2048 || !/^[A-Za-z0-9._~-]+$/.test(code)) {
    return new NextResponse("Authentication handoff is invalid or expired.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const clientId = process.env.WORKOS_CLIENT_ID?.trim() ?? "";
  if (!clientId.startsWith("client_")) {
    return returnToPikaUnavailable(state.nextPath);
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithCode({
      clientId,
      code,
      ...requestContext(request),
    });
    if (!authResponse.user.emailVerified) {
      return returnToPikaUnavailable(state.nextPath);
    }

    await bootstrapCurrentAppUser(authResponse.accessToken);
    await saveSession(authResponse, request);
    return NextResponse.redirect(buildPikaReturnUrl(state.nextPath), {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return returnToPikaUnavailable(state.nextPath);
  }
}
