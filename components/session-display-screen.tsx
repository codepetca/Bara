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
  const queriedLiveSession = useQuery(
    usesTokenAccess ? api.attendance.getLiveSessionRowsByToken : api.attendance.getLiveSessionRows,
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
      className={`flex min-h-dvh w-full items-center justify-center p-3 sm:p-4 ${
        isClosed ? "bg-amber-50/35" : ""
      }`.trim()}
    >
      <Card
        className={`flex min-h-[calc(100dvh-1.5rem)] w-full flex-col items-center px-3 py-4 text-center sm:min-h-[calc(100dvh-2rem)] sm:px-4 ${
          isClosed ? "border-amber-200 bg-amber-50/80" : ""
        }`.trim()}
      >
        <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-3 px-1 sm:flex-nowrap sm:px-2">
          <h1 className="min-w-0 text-left font-heading text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {displayContext.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {isClosed ? (
              <span className="inline-flex shrink-0 rounded-full bg-[var(--color-warning)]/15 px-3 py-1 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-warning-hover)]">
                Attendance is closed
              </span>
            ) : null}
            <PresentTotalPill presentCount={liveSession.counts.present} totalCount={totalCount} />
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-1 items-center justify-center pt-3">
          <div
            className="relative aspect-square w-[min(100%,calc(100dvh-8rem))] rounded-[24px] bg-white ring-1 ring-slate-950/5"
            data-testid="classroom-qr-stage"
          >
            <div className="absolute inset-[10.81%]" data-testid="classroom-qr-content">
              {isClosed ? (
                <div className="flex h-full w-full flex-col items-center justify-center rounded-[20px] bg-slate-50 px-6 text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning-hover)] shadow-sm sm:h-32 sm:w-32">
                    <Ban className="h-12 w-12 sm:h-16 sm:w-16" />
                  </div>
                  <p className="mt-6 max-w-xl text-lg font-medium leading-7 text-slate-700 sm:text-2xl sm:leading-9">
                    This QR code is no longer active.
                  </p>
                </div>
              ) : (
                <QRCode
                  value={checkInUrl}
                  aria-label="QR Code"
                  className="h-full w-full"
                  role="img"
                />
              )}
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}
