"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";

type StudentCheckInScreenProps = {
  token: string;
  fixtureState?: {
    context: {
      roster: {
        name: string;
      };
      session: {
        title: string;
        status: "open" | "closed";
      };
    } | null;
    result: {
      code:
        | "review_needed"
        | "present_marked"
        | "already_present"
        | "already_late"
        | "not_on_roster"
        | "session_closed"
        | "invalid_token"
        | "not_authorized";
      title: string;
      description: string;
      tone: "green" | "yellow" | "red";
      attendanceStatus?: "unmarked" | "present" | "late" | "absent";
    } | null;
    error: string | null;
    bootstrapError: string | null;
    isReady: boolean;
  };
};

function getTonePresentation(tone: "green" | "yellow" | "red" | null) {
  if (tone === "green") {
    return {
      badgeClassName: "border-emerald-200 bg-emerald-50/80 text-emerald-700",
      iconClassName: "bg-emerald-50 text-emerald-700",
      icon: CheckCircle2,
      label: "Checked in",
    };
  }

  if (tone === "yellow") {
    return {
      badgeClassName: "border-amber-200 bg-amber-50/80 text-amber-700",
      iconClassName: "bg-amber-50 text-amber-700",
      icon: AlertTriangle,
      label: "Needs help",
    };
  }

  if (tone === "red") {
    return {
      badgeClassName: "border-rose-200 bg-rose-50/80 text-rose-700",
      iconClassName: "bg-rose-50 text-rose-700",
      icon: XCircle,
      label: "Check-in failed",
    };
  }

  return {
    badgeClassName: "border-slate-200 bg-slate-50/90 text-slate-600",
    iconClassName: "bg-slate-100 text-slate-500",
    icon: null,
    label: "Checking in",
  };
}

export function StudentCheckInScreen({ token, fixtureState }: StudentCheckInScreenProps) {
  const queriedContext = useQuery(api.sessions.getCheckInContext, fixtureState ? "skip" : { token });
  const checkIn = useMutation(api.attendance.studentCheckIn);
  const authState = useCurrentAppUser();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkIn>> | null>(
    fixtureState?.result ?? null,
  );
  const [error, setError] = useState<string | null>(fixtureState?.error ?? null);
  const hasSubmittedRef = useRef(false);
  const context = fixtureState ? fixtureState.context : queriedContext;
  const bootstrapError = fixtureState?.bootstrapError ?? authState.bootstrapError;
  const isReady = fixtureState?.isReady ?? authState.isReady;

  useEffect(() => {
    if (fixtureState) {
      return;
    }

    if (
      !isReady ||
      context === undefined ||
      context === null ||
      hasSubmittedRef.current ||
      bootstrapError
    ) {
      return;
    }

    hasSubmittedRef.current = true;

    void checkIn({ token })
      .then((response) => {
        setResult(response);
      })
      .catch((checkInError) => {
        setError(
          checkInError instanceof Error ? checkInError.message : "Could not complete check-in.",
        );
      });
  }, [bootstrapError, checkIn, context, fixtureState, isReady, token]);

  const tone = result?.tone ?? (error ? "red" : null);
  const presentation = getTonePresentation(tone);
  const StatusIcon = presentation.icon;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
      <Card className="w-full px-6 py-8 text-center">
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${presentation.badgeClassName}`}
        >
          {presentation.label}
        </span>

        {StatusIcon ? (
          <div
            className={`mx-auto mt-5 inline-flex h-14 w-14 items-center justify-center rounded-full ${presentation.iconClassName}`}
          >
            <StatusIcon className="h-7 w-7" />
          </div>
        ) : null}

        <div className="mt-4">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-950">
            {result?.title ??
              (error
                ? "Check-in failed"
                : context === null
                  ? "Check-in link is invalid"
                  : "Checking you in")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {result?.description ??
              error ??
              (bootstrapError
                ? bootstrapError
                : context === null
                  ? "Ask your teacher for the current classroom QR code."
                  : context === undefined || !isReady
                    ? "Verifying your account for this attendance session."
                    : `${context.session.title} · ${context.roster.name}`)}
          </p>
        </div>

        {context && context !== null ? (
          <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-left text-sm text-slate-700">
            <div className="font-semibold text-slate-950">{context.session.title}</div>
            <div className="mt-1">{context.roster.name}</div>
            <div className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              {context.session.status === "open" ? "Session open" : "Session closed"}
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
