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
      checkedInAt?: number;
      student?: {
        displayName: string;
        studentId?: string;
      };
    } | null;
    error: string | null;
    bootstrapError: string | null;
    isReady: boolean;
  };
};

function getTonePresentation(tone: "green" | "yellow" | "red" | null) {
  if (tone === "green") {
    return {
      pageClassName: "bg-emerald-100 text-emerald-950",
      badgeClassName: "border-emerald-300 bg-white/60 text-emerald-800",
      iconWrapClassName: "border border-emerald-300 bg-white/55 text-emerald-700 shadow-sm",
      eyebrowClassName: "text-emerald-800/90",
      titleClassName: "text-emerald-950",
      supportingClassName: "text-emerald-900/80",
      metaClassName: "border-emerald-300/80 bg-white/55 text-emerald-900/80",
      icon: CheckCircle2,
      label: "Checked in",
    };
  }

  if (tone === "yellow") {
    return {
      pageClassName: "bg-amber-100 text-amber-950",
      badgeClassName: "border-amber-300 bg-white/60 text-amber-800",
      iconWrapClassName: "border border-amber-300 bg-white/55 text-amber-700 shadow-sm",
      eyebrowClassName: "text-amber-800/90",
      titleClassName: "text-amber-950",
      supportingClassName: "text-amber-900/80",
      metaClassName: "border-amber-300/80 bg-white/55 text-amber-900/80",
      icon: AlertTriangle,
      label: "Needs help",
    };
  }

  if (tone === "red") {
    return {
      pageClassName: "bg-rose-100 text-rose-950",
      badgeClassName: "border-rose-300 bg-white/60 text-rose-800",
      iconWrapClassName: "border border-rose-300 bg-white/55 text-rose-700 shadow-sm",
      eyebrowClassName: "text-rose-800/90",
      titleClassName: "text-rose-950",
      supportingClassName: "text-rose-900/80",
      metaClassName: "border-rose-300/80 bg-white/55 text-rose-900/80",
      icon: XCircle,
      label: "Check-in failed",
    };
  }

  return {
    pageClassName: "",
    badgeClassName: "border-slate-200 bg-slate-50/90 text-slate-600",
    iconWrapClassName: "bg-slate-100 text-slate-500",
    eyebrowClassName: "text-slate-500",
    titleClassName: "text-slate-950",
    supportingClassName: "text-slate-600",
    metaClassName: "border-slate-200 bg-slate-50/80 text-slate-700",
    icon: null,
    label: "Checking in",
  };
}

function formatCheckInTimestamp(timestamp: number) {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(timestamp);
  const weekday = dateParts.find((part) => part.type === "weekday")?.value ?? "";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "";
  const day = dateParts.find((part) => part.type === "day")?.value ?? "";

  return {
    date: [weekday, month, day].filter(Boolean).join(" "),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(timestamp),
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
  const isResultScreen = Boolean(result || error);
  const student = result?.student;
  const isStructuredResult = Boolean(student);
  const checkInMoment = result?.checkedInAt ? formatCheckInTimestamp(result.checkedInAt) : null;
  const resultSummary =
    tone === "green"
      ? null
      : tone === "yellow"
        ? "Needs help"
        : tone === "red"
          ? "Check-in unsuccessful"
          : null;

  if (isResultScreen) {
    return (
      <main
        className={`flex min-h-screen w-full items-center justify-center px-4 py-6 sm:px-6 ${presentation.pageClassName}`.trim()}
      >
        <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col items-center justify-center text-center">
          {isStructuredResult ? null : (
            <span
              className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] ${presentation.badgeClassName}`}
            >
              {presentation.label}
            </span>
          )}

          {StatusIcon ? (
            <div
              className={`${isStructuredResult ? "" : "mt-8 "}inline-flex h-28 w-28 items-center justify-center rounded-full sm:h-32 sm:w-32 ${presentation.iconWrapClassName}`.trim()}
            >
              <StatusIcon className="h-16 w-16 sm:h-20 sm:w-20" strokeWidth={1.75} />
            </div>
          ) : null}

          <div className="mt-8 max-w-4xl">
            {student ? (
              <>
                <h1
                  className="font-heading text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl"
                >
                  {student.displayName}
                </h1>
                {student.studentId ? (
                  <div
                    className={`mt-4 text-2xl font-semibold tracking-[0.22em] sm:text-3xl ${presentation.supportingClassName}`}
                  >
                    {student.studentId}
                  </div>
                ) : null}
                {resultSummary ? (
                  <div
                    className={`mt-8 inline-flex min-w-[16rem] flex-col rounded-[28px] border px-8 py-6 text-center ${presentation.metaClassName}`}
                  >
                    <div className="text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
                      {resultSummary}
                    </div>
                  </div>
                ) : null}
                {checkInMoment ? (
                  <div
                    className={`mt-8 inline-flex min-w-[16rem] flex-col rounded-[28px] border px-8 py-6 text-center ${presentation.metaClassName}`}
                  >
                    <div className="text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
                      {checkInMoment.date}
                    </div>
                    <div className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
                      {checkInMoment.time}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <h1
                className={`font-heading text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl ${presentation.titleClassName}`}
              >
                {result?.title ?? "Check-in failed"}
              </h1>
            )}

            {isStructuredResult ? null : (
              <p className={`mt-6 text-lg leading-8 sm:text-xl ${presentation.supportingClassName}`}>
                {result?.description ?? error}
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

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
            className={`mx-auto mt-5 inline-flex h-14 w-14 items-center justify-center rounded-full ${presentation.iconWrapClassName}`}
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
          <div className={`mt-6 rounded-[24px] border px-4 py-4 text-left text-sm ${presentation.metaClassName}`}>
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
