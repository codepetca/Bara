import { NextRequest, NextResponse } from "next/server";
import {
  buildPikaAuthorizeUrl,
  createPikaHandoffState,
  isPikaAuthHandoffEnabled,
} from "@/lib/pika-auth-handoff";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isPikaAuthHandoffEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const state = await createPikaHandoffState(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(buildPikaAuthorizeUrl(state.nonce), {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new NextResponse("Authentication handoff is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
