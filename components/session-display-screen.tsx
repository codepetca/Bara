"use client";

import { useQuery } from "convex/react";
import { Ban } from "lucide-react";
import QRCode from "react-qr-code";
import { useSyncExternalStore } from "react";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getConfiguredAppOrigin, resolveCheckInUrl } from "@/lib/session-links";

type SessionDisplayScreenProps = {
  sessionId?: string;
  token?: string;
  fixtureDisplay?: {
    displayContext: {
      title: string;
      rosterName: string;
      checkInToken: string;
      status?: "open" | "closed";
    };
    liveSession: {
      counts: {
        total?: number;
        present: number;
        late: number;
        unmarked: number;
        absent?: number;
      };
    };
  };
};

const subscribeToStaticOrigin = () => () => undefined;

function useRuntimeOrigin(configuredOrigin: string | null) {
  return useSyncExternalStore(
    subscribeToStaticOrigin,
    () => configuredOrigin ?? window.location.origin,
    () => configuredOrigin ?? "",
  );
}

export function SessionDisplayScreen({ sessionId, token, fixtureDisplay }: SessionDisplayScreenProps) {
  const usesTokenAccess = Boolean(token);
  const queriedDisplayContext = useQuery(
    usesTokenAccess ? api.sessions.getDisplayContextByToken : api.sessions.getDisplayContext,
    fixtureDisplay ? "skip" : usesTokenAccess ? { token: token! } : { sessionId: sessionId as Id<"sessions"> },
  );
  // Token access takes the counts-only projection: this screen is projected for
  // a whole room, so it must not receive participant names or contact details.
  const queriedLiveSession = useQuery(
    usesTokenAccess ? api.attendance.getDisplayCountsByToken : api.attendance.getLiveSessionRows,
    fixtureDisplay ? "skip" : usesTokenAccess ? { token: token! } : { sessionId: sessionId as Id<"sessions"> },
  );
  const configuredOrigin = getConfiguredAppOrigin();
  const runtimeOrigin = useRuntimeOrigin(configuredOrigin);

  const displayContext = fixtureDisplay?.displayContext ?? queriedDisplayContext;
  const liveSession = fixtureDisplay?.liveSession ?? queriedLiveSession;

  if (displayContext === undefined || liveSession === undefined) {
    return <div className="h-64 animate-pulse rounded-[28px] bg-white/80" />;
  }

  if (displayContext === null || liveSession === null) {
    return (
      <Card className="px-6 py-8 text-center text-sm text-slate-600">
        This session is unavailable.
      </Card>
    );
  }

  const checkInUrl = resolveCheckInUrl(displayContext.checkInToken, runtimeOrigin);
  const isClosed = displayContext.status === "closed";
  const totalCount =
    liveSession.counts.total ??
    liveSession.counts.present +
      liveSession.counts.late +
      liveSession.counts.unmarked +
      (liveSession.counts.absent ?? 0);

  return (
    <main
      className={`mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8 ${
        isClosed ? "bg-amber-50/35" : ""
      }`.trim()}
    >
      <Card className={`px-5 py-6 text-center sm:px-8 sm:py-8 ${isClosed ? "border-amber-200 bg-amber-50/80" : ""}`.trim()}>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {displayContext.title}
        </h1>
        {isClosed ? (
          <div className="mt-3 flex justify-center">
            <span className="inline-flex rounded-full bg-[var(--color-warning)]/15 px-3 py-1 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-warning-hover)]">
              Attendance is closed
            </span>
          </div>
        ) : null}

        <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
          <div className="mx-auto max-w-[320px] rounded-[24px] bg-white p-4 ring-1 ring-slate-950/5 sm:p-5">
            {isClosed ? (
              <div className="flex min-h-[288px] flex-col items-center justify-center rounded-[20px] bg-slate-50 px-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning-hover)] shadow-sm">
                  <Ban className="h-10 w-10" />
                </div>
                <p className="mt-4 max-w-xs text-sm leading-6 text-slate-600">
                  This QR code is no longer active.
                </p>
              </div>
            ) : (
              <QRCode value={checkInUrl} className="h-auto w-full" />
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-center">
          <PresentTotalPill presentCount={liveSession.counts.present} totalCount={totalCount} />
        </div>
      </Card>
    </main>
  );
}
