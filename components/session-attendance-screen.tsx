"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Search, Square } from "lucide-react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { useDeferredValue, useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { buildSessionDisplayPath, getConfiguredAppOrigin, resolveCheckInUrl } from "@/lib/session-links";

type SessionAttendanceScreenProps = {
  rosterId: string;
  sessionId: string;
  hideAuthControls?: boolean;
  fixtureSession?: {
    session: {
      _id: string;
      title: string;
      date: string;
      status: "open" | "closed";
      checkInToken: string;
    };
    roster: {
      _id: string;
      name: string;
    };
    counts: {
      total: number;
      present: number;
      late: number;
      unmarked: number;
      absent: number;
    };
    rows: Array<{
      participantId: string;
      displayName: string;
      firstName: string;
      lastName: string;
      studentId?: string;
      schoolEmail?: string;
      status: "unmarked" | "present" | "late" | "absent";
      lastMarkedAt?: number;
      modifiedAt: number;
      linkStatus: "linked" | "unlinked" | "ambiguous" | "review_needed";
      linkedAppUserId?: string;
    }>;
    unresolvedEvents: Array<{
      participantId?: string;
      participantName?: string;
      result: "review_needed" | "ignored";
      reasonCode?: string;
      createdAt: number;
    }>;
  };
};

type ManualAttendanceStatus = "present" | "late" | "unmarked";

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function getCountClasses(status: "present" | "late" | "unmarked" | "absent") {
  if (status === "present") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800";
  }

  if (status === "late") {
    return "border-amber-200 bg-amber-50/80 text-amber-800";
  }

  if (status === "absent") {
    return "border-rose-200 bg-rose-50/80 text-rose-700";
  }

  return "border-slate-200 bg-slate-50/90 text-slate-600";
}

function getStatusClasses(status: "unmarked" | "present" | "late" | "absent") {
  if (status === "present") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "late") {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "absent") {
    return "bg-rose-100 text-rose-700";
  }

  return "bg-slate-100 text-slate-600";
}

function getActionButtonClasses(status: ManualAttendanceStatus, active: boolean) {
  if (status === "present") {
    return active
      ? "bg-emerald-600 text-white"
      : "border border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800";
  }

  if (status === "late") {
    return active
      ? "bg-amber-500 text-white"
      : "border border-slate-300 bg-white text-slate-700 hover:border-amber-300 hover:text-amber-800";
  }

  return active
    ? "bg-slate-950 text-white"
    : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950";
}

function getLinkFlagLabel(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "review_needed") {
    return "Needs review";
  }

  if (status === "ambiguous") {
    return "Possible match";
  }

  return null;
}

export function SessionAttendanceScreen({
  rosterId,
  sessionId,
  hideAuthControls = false,
  fixtureSession,
}: SessionAttendanceScreenProps) {
  const queriedSession = useQuery(
    api.attendance.getLiveSessionRows,
    fixtureSession ? "skip" : { sessionId: sessionId as Id<"sessions"> },
  );
  const closeSession = useMutation(api.sessions.close);
  const markManual = useMutation(api.attendance.markManual);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const configuredOrigin = getConfiguredAppOrigin();
  const [runtimeOrigin, setRuntimeOrigin] = useState(configuredOrigin ?? "");

  useEffect(() => {
    if (configuredOrigin || typeof window === "undefined") {
      return;
    }

    setRuntimeOrigin(window.location.origin);
  }, [configuredOrigin]);

  const session = fixtureSession ?? queriedSession;
  const displayHref = buildSessionDisplayPath(rosterId, sessionId);

  async function handleManualMark(participantId: Id<"participants">, nextStatus: ManualAttendanceStatus) {
    if (fixtureSession) {
      return;
    }

    setError(null);
    setBusyKey(`${participantId}:${nextStatus}`);

    try {
      await markManual({
        sessionId: sessionId as Id<"sessions">,
        participantId,
        nextStatus,
      });
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : "Could not update attendance.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCloseSession() {
    if (fixtureSession) {
      return;
    }

    setError(null);
    setBusyKey("close-session");

    try {
      await closeSession({ sessionId: sessionId as Id<"sessions"> });
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Could not close session.");
    } finally {
      setBusyKey(null);
    }
  }

  if (session === undefined) {
    return (
      <PageShell title="Session" backHref={`/rosters/${rosterId}`}>
        <div className="h-56 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (session === null) {
    return (
      <PageShell title="Session not found" backHref={`/rosters/${rosterId}`}>
        <Card className="px-5 py-8 text-sm text-slate-600">This session does not exist.</Card>
      </PageShell>
    );
  }

  const filteredRows = session.rows.filter((row) => {
    if (!deferredSearch) {
      return true;
    }

    const haystack = `${row.displayName} ${row.studentId} ${row.schoolEmail ?? ""}`.toLocaleLowerCase();
    return haystack.includes(deferredSearch);
  });

  const checkInUrl = resolveCheckInUrl(session.session.checkInToken, runtimeOrigin);

  return (
    <PageShell
      title={session.session.title}
      subtitle={session.session.status === "open" ? "Live attendance session" : "Closed session"}
      backHref={`/rosters/${rosterId}`}
      hideAuthControls={hideAuthControls}
      headerAction={
        session.session.status === "open" ? (
          <Button
            variant="danger"
            size="sm"
            disabled={busyKey === "close-session"}
            onClick={() => void handleCloseSession()}
          >
            <Square className="mr-1 h-4 w-4" />
            Close
          </Button>
        ) : undefined
      }
    >
      <Card className="px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, ID, or email"
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <PresentTotalPill presentCount={session.counts.present} totalCount={session.counts.total} />
        </div>

        {error ? (
          <p className="mt-4 rounded-[24px] border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,15rem)] lg:items-start">
          <div>
            <p className="text-sm text-slate-600">
              {session.session.status === "open"
                ? "Mark anyone manually while students scan the QR code."
                : "This session is closed. You can still review the final attendance list."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getCountClasses("late")}`}
              >
                {session.counts.late} late
              </span>
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getCountClasses("unmarked")}`}
              >
                {session.counts.unmarked} unmarked
              </span>
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getCountClasses("absent")}`}
              >
                {session.counts.absent} absent
              </span>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Check-in tools
            </div>
            <p className="mt-1 text-sm text-slate-600">Students scan to check in.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center lg:grid-cols-1">
              <div className="mx-auto rounded-[20px] bg-white p-3 ring-1 ring-slate-950/5">
                <QRCode value={checkInUrl} className="h-auto w-28" />
              </div>
              <div className="flex flex-col gap-2">
                <CopyButton value={checkInUrl} />
                <Link href={displayHref} className="inline-flex">
                  <Button variant="outline" className="w-full">
                    <ArrowUpRight className="mr-1 h-4 w-4" />
                    Open display
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {session.unresolvedEvents.length > 0 ? (
        <Card className="px-4 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
              Needs review
            </h2>
            <p className="text-sm text-slate-500">
              {session.unresolvedEvents.length} check-in{session.unresolvedEvents.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {session.unresolvedEvents.map((event, index) => (
              <div
                key={`${event.createdAt}-${index}`}
                className="rounded-[24px] border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"
              >
                <div className="font-medium">
                  {event.participantName ?? "Unmatched student"}
                  {event.reasonCode ? ` · ${event.reasonCode.replace(/_/g, " ")}` : ""}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-amber-700">
                  {new Intl.DateTimeFormat(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(event.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section className="space-y-2">
        {filteredRows.map((row) => {
          const linkFlagLabel = getLinkFlagLabel(row.linkStatus);
          const secondaryMeta = row.studentId || row.schoolEmail || "No student ID";

          return (
            <Card key={row.participantId} variant="subtle" className="px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-slate-950">{row.displayName}</h2>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(row.status)}`}
                    >
                      {row.status}
                    </span>
                    {linkFlagLabel ? (
                      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {linkFlagLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">{secondaryMeta}</div>
                  {row.lastMarkedAt ? (
                    <div className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                      Last marked {formatTimestamp(row.lastMarkedAt)}
                    </div>
                  ) : null}
                </div>

                <div className="grid w-full grid-cols-3 gap-2 sm:w-[18rem]">
                  <button
                    type="button"
                    disabled={session.session.status !== "open" || busyKey !== null}
                    onClick={() => void handleManualMark(row.participantId as Id<"participants">, "present")}
                    className={`inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${getActionButtonClasses("present", row.status === "present")}`}
                  >
                    Present
                  </button>
                  <button
                    type="button"
                    disabled={session.session.status !== "open" || busyKey !== null}
                    onClick={() => void handleManualMark(row.participantId as Id<"participants">, "late")}
                    className={`inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${getActionButtonClasses("late", row.status === "late")}`}
                  >
                    Late
                  </button>
                  <button
                    type="button"
                    disabled={session.session.status !== "open" || busyKey !== null}
                    onClick={() => void handleManualMark(row.participantId as Id<"participants">, "unmarked")}
                    className={`inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${getActionButtonClasses("unmarked", row.status === "unmarked")}`}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </section>
    </PageShell>
  );
}
