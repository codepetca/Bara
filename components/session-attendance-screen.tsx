"use client";

import { useMutation, useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { cn } from "@/lib/cn";

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

type ManualAttendanceStatus = "present" | "unmarked";
type SortMode = "last" | "first" | "id";
type SessionParticipantRef = Id<"participants">;

const ATTENDANCE_TAP_EXIT_MS = 160;

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function isMarkedStatus(status: "unmarked" | "present" | "late" | "absent") {
  return status === "present" || status === "late";
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
  const markManual = useMutation(api.attendance.markManual);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("last");
  const [error, setError] = useState<string | null>(null);
  const [exitingParticipantRefs, setExitingParticipantRefs] = useState<Set<SessionParticipantRef>>(
    () => new Set(),
  );
  const [submittingParticipantRefs, setSubmittingParticipantRefs] = useState<Set<SessionParticipantRef>>(
    () => new Set(),
  );
  const [optimisticRows, setOptimisticRows] = useState<
    Record<
      string,
      {
        status: "unmarked" | "present" | "late" | "absent";
        lastMarkedAt?: number;
        modifiedAt: number;
      }
    >
  >({});
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const session = fixtureSession ?? queriedSession;

  useEffect(() => {
    if (!session) {
      return;
    }

    setOptimisticRows((current) => {
      let changed = false;
      const next = { ...current };

      for (const row of session.rows) {
        const optimisticRow = next[row.participantId];

        if (
          optimisticRow &&
          optimisticRow.status === row.status &&
          optimisticRow.lastMarkedAt === row.lastMarkedAt &&
          optimisticRow.modifiedAt === row.modifiedAt
        ) {
          delete next[row.participantId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [session]);

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

  const rows = session.rows.map((row) => {
    const optimisticRow = optimisticRows[row.participantId];

    if (!optimisticRow) {
      return row;
    }

    return {
      ...row,
      ...optimisticRow,
    };
  });

  const filteredRows = rows.filter((row) => {
    if (!deferredSearch) {
      return true;
    }

    const haystack = `${row.displayName} ${row.firstName} ${row.lastName} ${row.studentId ?? ""}`.toLocaleLowerCase();
    return haystack.includes(deferredSearch);
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const leftStudentId = left.studentId ?? "";
    const rightStudentId = right.studentId ?? "";

    if (sortMode === "id") {
      return leftStudentId.localeCompare(rightStudentId, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (sortMode === "first") {
      return (
        left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
        left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
        leftStudentId.localeCompare(rightStudentId, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }

    return (
      left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
      left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
      leftStudentId.localeCompare(rightStudentId, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });

  const unmarkedRows = sortedRows.filter((row) => !isMarkedStatus(row.status));
  const markedRows = sortedRows.filter((row) => isMarkedStatus(row.status));
  const markedCount = rows.filter((row) => isMarkedStatus(row.status)).length;
  const studentGridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr) minmax(6.5rem, 0.9fr)";
  const isSessionOpen = session.session.status === "open";

  function setParticipantTransitionState(
    participantId: SessionParticipantRef,
    setter: Dispatch<SetStateAction<Set<SessionParticipantRef>>>,
    active: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);

      if (active) {
        next.add(participantId);
      } else {
        next.delete(participantId);
      }

      return next;
    });
  }

  async function handleToggle(row: (typeof rows)[number]) {
    if (fixtureSession || !isSessionOpen || submittingParticipantRefs.has(row.participantId as SessionParticipantRef)) {
      return;
    }

    const nextStatus: ManualAttendanceStatus = isMarkedStatus(row.status) ? "unmarked" : "present";
    const now = Date.now();
    const previousOverride = optimisticRows[row.participantId];

    setError(null);
    setParticipantTransitionState(row.participantId as SessionParticipantRef, setSubmittingParticipantRefs, true);
    setParticipantTransitionState(row.participantId as SessionParticipantRef, setExitingParticipantRefs, true);
    setOptimisticRows((current) => ({
      ...current,
      [row.participantId]: {
        status: nextStatus,
        lastMarkedAt: nextStatus === "unmarked" ? undefined : now,
        modifiedAt: now,
      },
    }));

    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, ATTENDANCE_TAP_EXIT_MS);
      });

      setParticipantTransitionState(row.participantId as SessionParticipantRef, setExitingParticipantRefs, false);
      await markManual({
        sessionId: sessionId as Id<"sessions">,
        participantId: row.participantId as Id<"participants">,
        nextStatus,
      });
      setSearch("");
    } catch (markError) {
      setOptimisticRows((current) => {
        const next = { ...current };

        if (previousOverride) {
          next[row.participantId] = previousOverride;
        } else {
          delete next[row.participantId];
        }

        return next;
      });
      setError(markError instanceof Error ? markError.message : "Could not update attendance.");
    } finally {
      setParticipantTransitionState(row.participantId as SessionParticipantRef, setExitingParticipantRefs, false);
      setParticipantTransitionState(row.participantId as SessionParticipantRef, setSubmittingParticipantRefs, false);
    }
  }

  return (
    <PageShell
      title={session.session.title}
      backHref={`/rosters/${rosterId}`}
      hideAuthControls={hideAuthControls}
    >
      <Card className="rounded-[30px] border-emerald-100 bg-[linear-gradient(180deg,#ffffff_0%,#f2fbf7_100%)] px-4 py-4">
        <div className="flex items-stretch gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or student ID"
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-12 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <PresentTotalPill presentCount={markedCount} totalCount={session.counts.total} className="self-center" />
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <div
          className="mt-4 grid items-center gap-3 px-2 text-left font-semibold uppercase tracking-[0.16em]"
          style={{ gridTemplateColumns: studentGridTemplateColumns }}
        >
          <button
            type="button"
            onClick={() => setSortMode("first")}
            className={`truncate border-b-2 py-0.5 text-left leading-none transition ${
              sortMode === "first"
                ? "border-slate-300 text-base text-slate-950"
                : "border-transparent text-base text-slate-500 hover:text-slate-950"
            }`}
          >
            First
          </button>
          <button
            type="button"
            onClick={() => setSortMode("last")}
            className={`truncate border-b-2 py-0.5 text-left leading-none transition ${
              sortMode === "last"
                ? "border-slate-300 text-base text-slate-950"
                : "border-transparent text-base text-slate-500 hover:text-slate-950"
            }`}
          >
            Last
          </button>
          <button
            type="button"
            onClick={() => setSortMode("id")}
            className={`border-b-2 py-0.5 text-left leading-none transition ${
              sortMode === "id"
                ? "border-slate-300 text-base text-slate-950"
                : "border-transparent text-base text-slate-500 hover:text-slate-950"
            }`}
          >
            ID
          </button>
        </div>
      </Card>

      <section className="mt-0">
        <div>
          {unmarkedRows.map((row) => {
            const participantId = row.participantId as SessionParticipantRef;
            const isSubmitting = submittingParticipantRefs.has(participantId);
            const isExiting = exitingParticipantRefs.has(participantId);

            return (
              <div
                key={row.participantId}
                className={cn(
                  "grid overflow-hidden transition-[grid-template-rows,margin-bottom,opacity] duration-180 ease-in",
                  isExiting ? "mb-0 grid-rows-[0fr] opacity-80" : "mb-1.5 grid-rows-[1fr] opacity-100 last:mb-0",
                )}
              >
                <div className="min-h-0">
                  <button
                    type="button"
                    onClick={() => void handleToggle(row)}
                    disabled={!isSessionOpen || isSubmitting}
                    aria-busy={isSubmitting}
                    className={cn(
                      "grid min-h-13 w-full origin-top items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.99] disabled:cursor-wait",
                      isExiting && "pointer-events-none scale-y-75 opacity-40",
                    )}
                    style={{ gridTemplateColumns: studentGridTemplateColumns }}
                  >
                    <div className="min-w-0 text-base font-semibold text-slate-950">
                      <span className="block truncate">{row.firstName || " "}</span>
                    </div>
                    <div className="min-w-0 text-base font-semibold text-slate-950">
                      <span className="block truncate">{row.lastName || row.displayName}</span>
                    </div>
                    <div className="text-left text-sm font-medium text-slate-500">{row.studentId ?? "—"}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4 pb-8">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">
            Present
          </h2>
          <span className="text-sm text-slate-500">{markedRows.length}</span>
        </div>
        <div>
          {markedRows.map((row) => {
            const participantId = row.participantId as SessionParticipantRef;
            const isSubmitting = submittingParticipantRefs.has(participantId);
            const isExiting = exitingParticipantRefs.has(participantId);

            return (
              <div
                key={row.participantId}
                className={cn(
                  "grid overflow-hidden transition-[grid-template-rows,margin-bottom,opacity] duration-180 ease-in",
                  isExiting ? "mb-0 grid-rows-[0fr] opacity-80" : "mb-1.5 grid-rows-[1fr] opacity-100 last:mb-0",
                )}
              >
                <div className="min-h-0">
                  <button
                    type="button"
                    onClick={() => void handleToggle(row)}
                    disabled={!isSessionOpen || isSubmitting}
                    aria-busy={isSubmitting}
                    className={cn(
                      "grid min-h-13 w-full origin-top items-center gap-3 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-100/70 active:scale-[0.99] disabled:cursor-wait",
                      isExiting && "pointer-events-none scale-y-75 opacity-40",
                    )}
                    style={{ gridTemplateColumns: studentGridTemplateColumns }}
                  >
                    <div className="min-w-0 text-base font-semibold text-slate-950">
                      <span className="block truncate">{row.firstName || " "}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-950">
                        {row.lastName || row.displayName}
                      </div>
                      <div className="mt-1 text-xs font-medium text-emerald-700">
                        {row.status === "late" ? "Late" : "Present"}
                        {row.lastMarkedAt ? ` · ${formatTimestamp(row.lastMarkedAt)}` : ""}
                      </div>
                    </div>
                    <div className="text-left text-sm font-medium text-emerald-700/80">{row.studentId ?? "—"}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

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
    </PageShell>
  );
}
