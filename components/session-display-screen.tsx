"use client";

import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getConfiguredAppOrigin, resolveCheckInUrl } from "@/lib/session-links";

type SessionDisplayScreenProps = {
  sessionId: string;
  fixtureDisplay?: {
    displayContext: {
      title: string;
      rosterName: string;
      checkInToken: string;
    };
    liveSession: {
      counts: {
        present: number;
        late: number;
        unmarked: number;
      };
    };
  };
};

function getCountClasses(status: "present" | "late" | "unmarked") {
  if (status === "present") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800";
  }

  if (status === "late") {
    return "border-amber-200 bg-amber-50/80 text-amber-800";
  }

  return "border-slate-200 bg-slate-50/90 text-slate-600";
}

export function SessionDisplayScreen({ sessionId, fixtureDisplay }: SessionDisplayScreenProps) {
  const queriedDisplayContext = useQuery(
    api.sessions.getDisplayContext,
    fixtureDisplay ? "skip" : { sessionId: sessionId as Id<"sessions"> },
  );
  const queriedLiveSession = useQuery(
    api.attendance.getLiveSessionRows,
    fixtureDisplay ? "skip" : { sessionId: sessionId as Id<"sessions"> },
  );
  const configuredOrigin = getConfiguredAppOrigin();
  const [runtimeOrigin, setRuntimeOrigin] = useState(configuredOrigin ?? "");

  useEffect(() => {
    if (configuredOrigin || typeof window === "undefined") {
      return;
    }

    setRuntimeOrigin(window.location.origin);
  }, [configuredOrigin]);

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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8">
      <Card className="px-5 py-6 text-center sm:px-8 sm:py-8">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          {displayContext.rosterName}
        </div>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {displayContext.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Students scan the QR code with their signed-in Tapcheck account.
        </p>

        <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
          <div className="mx-auto max-w-[320px] rounded-[24px] bg-white p-4 ring-1 ring-slate-950/5 sm:p-5">
            <QRCode value={checkInUrl} className="h-auto w-full" />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold">
          <span
            className={`inline-flex rounded-full border px-4 py-2 ${getCountClasses("present")}`}
          >
            {liveSession.counts.present} present
          </span>
          <span className={`inline-flex rounded-full border px-4 py-2 ${getCountClasses("late")}`}>
            {liveSession.counts.late} late
          </span>
          <span
            className={`inline-flex rounded-full border px-4 py-2 ${getCountClasses("unmarked")}`}
          >
            {liveSession.counts.unmarked} unmarked
          </span>
        </div>
      </Card>
    </main>
  );
}
