"use client";

import Papa from "papaparse";
import { Check, Copy, ExternalLink, Link2, Link2Off, Pencil, Play, QrCode, Send, Settings2, Square, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ManagedScheduleFields } from "@/components/managed-schedule-fields";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import {
  createDefaultManagedScheduleForm,
  formatMinutes,
  formatWeekdays,
  getTodayDateString,
  minutesToTime,
  timeToMinutes,
  type ManagedScheduleFormState,
} from "@/lib/managed-schedule";
import { useAppOrigin } from "@/lib/use-app-origin";
import {
  buildAbsoluteUrl,
  buildDisplayPath,
  buildEditorPath,
  getConfiguredAppOrigin,
} from "@/lib/session-links";

type SortColumn = "firstName" | "lastName" | "studentId" | "linkStatus" | "status";
type SortDirection = "asc" | "desc";
type RecurringScheduleFormState = ManagedScheduleFormState;
type VerifiedCheckInSummary = {
  totalStudents: number;
  readyStudents: number;
  linkedStudents: number;
  missingIdentifierStudents: number;
  reviewNeededStudents: number;
};

type SplitLinkActionProps = {
  href: string;
  label: string;
  openLabel: string;
  copyLabel: string;
  copyValue: string;
  copied: boolean;
  disabled?: boolean;
  trailingIcon?: ReactNode;
  onCopy: () => void;
};

function sanitizeFilePart(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function downloadCsvFile(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getLinkStatusClasses(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "linked") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "ambiguous" || status === "review_needed") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-600";
}

function getLinkStatusRank(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "linked") {
    return 0;
  }

  if (status === "ambiguous") {
    return 1;
  }

  if (status === "review_needed") {
    return 2;
  }

  return 3;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function getStudentQrReadiness(summary: VerifiedCheckInSummary) {
  if (summary.totalStudents === 0) {
    return null;
  }

  const blockedStudents = summary.totalStudents - summary.readyStudents;

  if (blockedStudents === 0) {
    return {
      hasGaps: false,
      title: "Student QR ready",
      description: `All ${summary.totalStudents} students are ready for QR self check-in.`,
    };
  }

  if (summary.readyStudents === 0) {
    return {
      hasGaps: true,
      title: "Student QR needs accounts",
      description: "QR self check-in needs student accounts that match roster IDs or emails. Staff Tap works now.",
    };
  }

  return {
    hasGaps: true,
    title: "Student QR partly ready",
    description:
      `${summary.readyStudents} of ${summary.totalStudents} students are ready for QR self check-in. ` +
      "Use Staff Tap for the rest.",
  };
}

function getFallbackVerifiedCheckInSummary(
  students: Array<{
    studentId: string;
    schoolEmail?: string;
    linkedAppUserId?: Id<"app_users">;
  }>,
): VerifiedCheckInSummary {
  let linkedStudents = 0;
  let missingIdentifierStudents = 0;

  for (const student of students) {
    if (student.linkedAppUserId) {
      linkedStudents += 1;
      continue;
    }

    if (!student.studentId && !student.schoolEmail) {
      missingIdentifierStudents += 1;
    }
  }

  return {
    totalStudents: students.length,
    readyStudents: linkedStudents,
    linkedStudents,
    missingIdentifierStudents,
    reviewNeededStudents: students.length - linkedStudents - missingIdentifierStudents,
  };
}

function SplitLinkAction({
  href,
  label,
  openLabel,
  copyLabel,
  copyValue,
  copied,
  disabled = false,
  trailingIcon,
  onCopy,
}: SplitLinkActionProps) {
  const openClassName = buttonVariants({
    variant: "primary",
    className:
      "h-14 min-w-0 flex-1 justify-center rounded-r-none bg-slate-800 px-4 text-center hover:bg-slate-700",
  });
  const copyClassName = buttonVariants({
    variant: "primary",
    className: "h-14 w-14 shrink-0 rounded-l-none border-l border-slate-700 bg-slate-700 px-0 hover:bg-slate-600",
  });

  return (
    <div className="flex min-w-0">
      {disabled ? (
        <span
          aria-label={openLabel}
          aria-disabled="true"
          className={`${openClassName} pointer-events-none bg-slate-300 text-white`}
        >
          <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          {trailingIcon}
        </span>
      ) : (
        <Link href={href} aria-label={openLabel} className={openClassName}>
          <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          {trailingIcon}
        </Link>
      )}
      <button
        type="button"
        aria-label={copyLabel}
        title={copyValue}
        onClick={onCopy}
        disabled={disabled}
        className={`${copyClassName} ${disabled ? "border-slate-300 bg-slate-300 text-white hover:bg-slate-300" : ""}`}
      >
        {copied ? <span className="text-xs font-semibold">OK</span> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const { rosterId } = use(params);
  const router = useRouter();
  const { bootstrapError, isReady } = useCurrentAppUser();
  const renameRoster = useMutation(api.rosters.rename);
  const deleteRoster = useMutation(api.rosters.remove);
  const startSession = useMutation(api.sessions.start);
  const closeSession = useMutation(api.sessions.close);
  const saveSchedule = useMutation(api.schedules.upsertForRoster);
  const setClassDayOverride = useMutation(api.schedules.setClassDayOverride);
  const ensureShareToken = useMutation(api.rosters.ensureShareToken);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ensuredShareToken, setEnsuredShareToken] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [copiedAction, setCopiedAction] = useState<"manual" | "terminal" | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);
  const isDeleting = busyKey === "delete";
  const data = useQuery(api.rosters.getById, isReady ? { rosterId: rosterId as Id<"rosters"> } : "skip");
  const configuredOrigin = getConfiguredAppOrigin();
  const runtimeOrigin = useAppOrigin(configuredOrigin);
  const scheduleDetails = useQuery(
    api.schedules.getForRoster,
    isReady && !isDeleting && data?.roster ? { rosterId: rosterId as Id<"rosters"> } : "skip",
  );
  const [scheduleForm, setScheduleForm] = useState<RecurringScheduleFormState>(() =>
    createDefaultManagedScheduleForm(),
  );
  const [scheduleFormTouched, setScheduleFormTouched] = useState(false);
  const [isScheduleEditorOpen, setIsScheduleEditorOpen] = useState(false);
  const shareTokenRequestRef = useRef<string | null>(null);

  const latestSessionId = data?.sessions[0]?._id;
  const latestSession = data?.sessions[0] ?? null;
  const activeSession = data?.sessions.find((session) => session.status === "open") ?? null;
  const sessionExport = useQuery(
    api.attendance.getSessionExport,
    latestSessionId && !isDeleting ? { sessionId: latestSessionId } : "skip",
  );

  async function handleRename() {
    if (!data) {
      return;
    }

    const nextName = draftTitle.trim();
    if (!nextName) {
      setError("Roster name is required.");
      return;
    }

    setBusyKey("rename");
    setError(null);
    try {
      await renameRoster({
        rosterId: data.roster._id,
        name: nextName,
      });
      setIsEditingTitle(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename roster.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStartSession() {
    if (!data) {
      return;
    }

    setBusyKey("start");
    setError(null);
    try {
      await startSession({
        rosterId: data.roster._id,
        date: getTodayDateString(),
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start session.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCloseSession() {
    if (!activeSession) {
      return;
    }

    setBusyKey("close-session");
    setError(null);
    try {
      await closeSession({ sessionId: activeSession._id });
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Could not close session.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveSchedule() {
    if (!data) {
      return;
    }

    setBusyKey("save-schedule");
    setError(null);
    try {
      await saveSchedule({
        rosterId: data.roster._id,
        config: {
          startDate: scheduleForm.startDate,
          ...(scheduleForm.endDate ? { endDate: scheduleForm.endDate } : {}),
          timezone: scheduleForm.timezone,
          weekdays: scheduleForm.weekdays,
          startMinutes: timeToMinutes(scheduleForm.startTime),
          endMinutes: timeToMinutes(scheduleForm.endTime),
          autoOpen: scheduleForm.autoOpen,
          autoOpenOffsetMinutes: Number(scheduleForm.autoOpenOffsetMinutes),
          autoCloseOffsetMinutes: Number(scheduleForm.autoCloseOffsetMinutes),
          autoCloseGraceMinutes: Number(scheduleForm.autoCloseGraceMinutes),
          active: scheduleForm.active,
        },
      });
      setScheduleFormTouched(false);
      setIsScheduleEditorOpen(false);
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "Could not save the recurring schedule.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleClassDayStatusChange(date: string, status: "scheduled" | "skipped", key: string) {
    if (!data) {
      return;
    }

    setBusyKey(key);
    setError(null);
    try {
      await setClassDayOverride({
        rosterId: data.roster._id,
        date,
        status,
      });
    } catch (classDayError) {
      setError(classDayError instanceof Error ? classDayError.message : "Could not update the class day.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteRoster() {
    if (!data) {
      return;
    }

    setBusyKey("delete");
    setError(null);
    try {
      await deleteRoster({ rosterId: data.roster._id });
      router.push("/");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete roster.");
      setBusyKey(null);
    }
  }

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setEnsuredShareToken(null);
    shareTokenRequestRef.current = null;
  }, [rosterId]);

  useEffect(() => {
    if (!scheduleDetails || scheduleDetails.mode !== "standalone" || scheduleFormTouched) {
      return;
    }

    if (!scheduleDetails.schedule) {
      setScheduleForm(createDefaultManagedScheduleForm());
      return;
    }

    setScheduleForm({
      startDate: scheduleDetails.schedule.startDate,
      endDate: scheduleDetails.schedule.endDate ?? "",
      timezone: scheduleDetails.schedule.timezone,
      weekdays: scheduleDetails.schedule.weekdays,
      startTime: minutesToTime(scheduleDetails.schedule.startMinutes),
      endTime: minutesToTime(scheduleDetails.schedule.endMinutes),
      autoOpen: scheduleDetails.schedule.autoOpen,
      autoOpenOffsetMinutes: String(scheduleDetails.schedule.autoOpenOffsetMinutes),
      autoCloseOffsetMinutes: String(scheduleDetails.schedule.autoCloseOffsetMinutes),
      autoCloseGraceMinutes: String(scheduleDetails.schedule.autoCloseGraceMinutes),
      active: scheduleDetails.schedule.active,
    });
  }, [scheduleDetails, scheduleFormTouched]);

  useEffect(() => {
    if (!isReady || isDeleting || !data?.roster || data.roster.shareToken || ensuredShareToken) {
      return;
    }

    if (shareTokenRequestRef.current === data.roster._id) {
      return;
    }

    shareTokenRequestRef.current = data.roster._id;
    void ensureShareToken({ rosterId: data.roster._id })
      .then((shareToken) => setEnsuredShareToken(shareToken))
      .catch(() => {
        shareTokenRequestRef.current = null;
      });
  }, [data?.roster, ensureShareToken, ensuredShareToken, isDeleting, isReady]);

  if (bootstrapError) {
    return (
      <PageShell title="Roster" backHref="/">
        <section className="rounded-[28px] border border-rose-200 bg-rose-50/90 px-5 py-6 text-sm text-rose-800 shadow-sm">
          {bootstrapError}
        </section>
      </PageShell>
    );
  }

  if (!isReady || data === undefined) {
    return (
      <PageShell title="Roster" backHref="/">
        <div className="h-56 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (data === null) {
    return (
      <PageShell title="Roster not found" backHref="/">
        <Card className="px-5 py-8 text-sm text-slate-600">This roster does not exist.</Card>
      </PageShell>
    );
  }

  const attendanceByStudentId = new Map(sessionExport?.rows.map((row) => [row.studentId, row.present]) ?? []);
  const shareToken = data.roster.shareToken ?? ensuredShareToken ?? latestSession?.checkInToken ?? "";
  const hasShareableLinks = Boolean(shareToken);
  const manualPath = shareToken ? buildEditorPath(shareToken) : "";
  const terminalPath = shareToken ? buildDisplayPath(shareToken) : "";
  const manualUrl = runtimeOrigin ? buildAbsoluteUrl(runtimeOrigin, manualPath) : manualPath;
  const terminalUrl = runtimeOrigin ? buildAbsoluteUrl(runtimeOrigin, terminalPath) : terminalPath;
  const students = [...data.students]
    .map((student) => ({
      ...student,
      isPresent: attendanceByStudentId.get(student.studentId) === true,
    }))
    .sort((left, right) => {
      let comparison = 0;

      if (sortColumn === "firstName") {
        comparison =
          compareText(left.firstName || left.displayName, right.firstName || right.displayName) ||
          compareText(left.lastName || left.displayName, right.lastName || right.displayName) ||
          compareText(left.studentId, right.studentId);
      } else if (sortColumn === "lastName") {
        comparison =
          compareText(left.lastName || left.displayName, right.lastName || right.displayName) ||
          compareText(left.firstName || left.displayName, right.firstName || right.displayName) ||
          compareText(left.studentId, right.studentId);
      } else if (sortColumn === "studentId") {
        comparison =
          compareText(left.studentId, right.studentId) ||
          compareText(left.lastName || left.displayName, right.lastName || right.displayName) ||
          compareText(left.firstName || left.displayName, right.firstName || right.displayName);
      } else if (sortColumn === "linkStatus") {
        comparison =
          getLinkStatusRank(left.linkStatus) - getLinkStatusRank(right.linkStatus) ||
          compareText(left.lastName || left.displayName, right.lastName || right.displayName) ||
          compareText(left.firstName || left.displayName, right.firstName || right.displayName);
      } else {
        const leftRank = (left.isPresent ? 0 : 1) + (left.linkStatus === "linked" ? 0 : 2);
        const rightRank = (right.isPresent ? 0 : 1) + (right.linkStatus === "linked" ? 0 : 2);
        comparison =
          leftRank - rightRank ||
          compareText(left.lastName || left.displayName, right.lastName || right.displayName) ||
          compareText(left.firstName || left.displayName, right.firstName || right.displayName);
      }

      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  const presentCount = students.filter((student) => student.isPresent).length;
  const totalCount = data.students.length;
  const verifiedCheckIn =
    data.verifiedCheckIn ?? getFallbackVerifiedCheckInSummary(data.students);
  const studentQrReadiness = getStudentQrReadiness(verifiedCheckIn);
  const isStandaloneRoster = scheduleDetails?.mode === "standalone" || data.roster.mode === "standalone";
  const isLinkedRoster = scheduleDetails?.mode === "pika_linked" || data.roster.mode === "pika_linked";
  const hasSavedSchedule = Boolean(scheduleDetails?.schedule);
  const hasActiveManagedSchedule = Boolean(scheduleDetails?.schedule?.active);
  const scheduleStatusLabel = isLinkedRoster
    ? "Pika-linked"
    : hasActiveManagedSchedule
      ? "Recurring"
      : hasSavedSchedule
        ? "Recurring paused"
        : "One-off";
  const isScheduleEditorVisible = isStandaloneRoster && isScheduleEditorOpen;
  const todayClassDay =
    scheduleDetails?.upcomingClassDays.find((classDay) => classDay.date === getTodayDateString()) ?? null;
  const canSkipToday =
    hasActiveManagedSchedule &&
    todayClassDay?.status === "scheduled" &&
    todayClassDay.linkedSessionStatus === null &&
    activeSession === null;

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortColumn(column);
    setSortDirection("asc");
  }

  function renderSortLabel(label: string, column: SortColumn) {
    return (
      <button
        type="button"
        onClick={() => handleSort(column)}
        className="font-medium text-slate-600 transition hover:text-slate-950"
      >
        {label}
      </button>
    );
  }

  async function handleCopyAction(action: "manual" | "terminal", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedAction(action);
    if (copiedTimeoutRef.current !== null) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopiedAction((current) => (current === action ? null : current));
      copiedTimeoutRef.current = null;
    }, 1800);
  }

  async function handleExportCsv() {
    if (!sessionExport) {
      return;
    }

    setIsExporting(true);
    setError(null);
    try {
      const fileName = `${sanitizeFilePart(sessionExport.roster.name)}-${sessionExport.session.date}-attendance.csv`;
      const csv = Papa.unparse([
        ["Date", sessionExport.session.date],
        [],
        ["Student ID", "Student Name", "Status"],
        ...sessionExport.rows.map((row) => [
          row.studentId,
          row.displayName || row.rawName,
          row.present ? "Present" : "Absent",
        ]),
      ]);

      downloadCsvFile(csv, fileName);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export attendance CSV.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <PageShell
      titleContainerClassName={isEditingTitle ? "px-10 sm:px-16" : undefined}
      title={
        isEditingTitle ? (
          <div>
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRename();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraftTitle(data.roster.name);
                  setIsEditingTitle(false);
                  setError(null);
                }
              }}
              disabled={busyKey === "rename"}
              className="font-heading h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-2xl font-semibold tracking-tight text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftTitle(data.roster.name);
              setIsEditingTitle(true);
              setError(null);
            }}
            className="font-heading w-full text-center text-xl font-semibold tracking-tight text-slate-950 transition hover:text-slate-700"
          >
            {data.roster.name}
          </button>
        )
      }
      backHref="/"
    >
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Roster?"
        description={`Delete roster "${data.roster.name}"? This removes its students, sessions, and attendance history.`}
        confirmLabel="Delete roster"
        tone="danger"
        busy={busyKey === "delete"}
        onConfirm={() => void handleDeleteRoster()}
        onCancel={() => setDeleteOpen(false)}
      />

      <Card className="space-y-3">
        {activeSession ? (
          <>
            <Button
              variant="warning"
              className="h-14 w-full text-base"
              onClick={() => void handleCloseSession()}
              disabled={busyKey === "close-session"}
            >
              <Square className="mr-2 h-4 w-4" />
              Close Attendance
            </Button>
            {hasShareableLinks ? (
              <div className="grid grid-cols-2 gap-2">
                <SplitLinkAction
                  href={manualPath}
                  label="Staff Tap"
                  openLabel="Open staff tap attendance"
                  copyLabel="Copy staff tap link"
                  copyValue={manualUrl}
                  copied={copiedAction === "manual"}
                  onCopy={() => void handleCopyAction("manual", manualUrl)}
                />
                <SplitLinkAction
                  href={terminalPath}
                  label="Student QR"
                  openLabel="Open student QR"
                  copyLabel="Copy student QR link"
                  copyValue={terminalUrl}
                  copied={copiedAction === "terminal"}
                  trailingIcon={<QrCode className="ml-2 h-4 w-4 shrink-0" />}
                  onCopy={() => void handleCopyAction("terminal", terminalUrl)}
                />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Button
              className="h-14 w-full text-base"
              onClick={() => void handleStartSession()}
              disabled={busyKey === "start" || data.students.length === 0}
            >
              <Play className="mr-2 h-4 w-4 fill-current" />
              Open Attendance
            </Button>
            {hasShareableLinks ? (
              <div className="grid grid-cols-2 gap-2">
                <SplitLinkAction
                  href={manualPath}
                  label="Staff Tap"
                  openLabel="Open staff tap attendance"
                  copyLabel="Copy staff tap link"
                  copyValue={manualUrl}
                  copied={copiedAction === "manual"}
                  onCopy={() => void handleCopyAction("manual", manualUrl)}
                />
                <SplitLinkAction
                  href={terminalPath}
                  label="Student QR"
                  openLabel="Open student QR"
                  copyLabel="Copy student QR link"
                  copyValue={terminalUrl}
                  copied={copiedAction === "terminal"}
                  trailingIcon={<QrCode className="ml-2 h-4 w-4 shrink-0" />}
                  onCopy={() => void handleCopyAction("terminal", terminalUrl)}
                />
              </div>
            ) : null}
          </>
        )}
        {studentQrReadiness ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              studentQrReadiness.hasGaps
                ? "border-amber-200 bg-amber-50/70 text-amber-900"
                : "border-slate-200 bg-slate-50/80 text-slate-600"
            }`}
          >
            <div
              className={
                studentQrReadiness.hasGaps ? "font-medium text-amber-950" : "font-medium text-slate-900"
              }
            >
              {studentQrReadiness.title}
            </div>
            <div className="mt-1">{studentQrReadiness.description}</div>
          </div>
        ) : null}
      </Card>

      {scheduleDetails !== undefined ? (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {isLinkedRoster ? "Attendance source" : "Managed in Tapcheck"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {isLinkedRoster
                  ? "This roster can accept linked class-day data later. Tapcheck still runs the live attendance session."
                  : hasActiveManagedSchedule
                    ? "Tapcheck can open attendance before class, close it later, and let you skip dates when plans change."
                    : "Use this class for one-off attendance, or turn on recurring timing from Settings when you need it."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isStandaloneRoster ? (
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => setIsScheduleEditorOpen((current) => !current)}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              ) : null}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                {scheduleStatusLabel}
              </span>
            </div>
          </div>

          {isStandaloneRoster ? (
            <>
              {!isScheduleEditorVisible ? (
                <div className="space-y-3 rounded-2xl border border-slate-200 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-sm text-slate-600">
                      {hasActiveManagedSchedule ? (
                        <>
                          <div className="font-medium text-slate-900">{formatWeekdays(scheduleForm.weekdays)}</div>
                          <div className="mt-1">
                            {scheduleForm.startTime} to {scheduleForm.endTime}
                          </div>
                          <div className="mt-1">
                            {scheduleForm.endDate
                              ? `${scheduleForm.startDate} to ${scheduleForm.endDate}`
                              : `Starts ${scheduleForm.startDate}`}
                          </div>
                          <div className="mt-1">
                            {scheduleForm.autoOpen
                              ? `Attendance opens ${scheduleForm.autoOpenOffsetMinutes} min early`
                              : "Attendance opens manually"}
                          </div>
                          <div className="mt-1">Attendance closes {scheduleForm.autoCloseOffsetMinutes} min early</div>
                        </>
                      ) : hasSavedSchedule ? (
                        <>
                          <div className="font-medium text-slate-900">Recurring paused</div>
                          <div className="mt-1">
                            {formatWeekdays(scheduleForm.weekdays)}, {scheduleForm.startTime} to {scheduleForm.endTime}
                          </div>
                          <div className="mt-1">Attendance opens only when you start it manually.</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-slate-900">One-off attendance</div>
                          <div className="mt-1">Attendance opens only when you start it from this roster.</div>
                          <div className="mt-1">No recurring timing is saved yet.</div>
                        </>
                      )}
                    </div>
                  </div>

                  {canSkipToday ? (
                    <Button
                      variant="outline"
                      className="h-11 w-full border-amber-200 text-amber-900 hover:bg-amber-50"
                      onClick={() => void handleClassDayStatusChange(todayClassDay.date, "skipped", "skip-today")}
                      disabled={busyKey === "skip-today"}
                    >
                      Skip today
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4 rounded-2xl border border-slate-200 px-4 py-4">
                  <div className="space-y-3">
                    <div className="text-base font-semibold text-slate-900">Attendance settings</div>
                    <div className="flex rounded-2xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleFormTouched(true);
                          setScheduleForm((current) => ({ ...current, active: false }));
                        }}
                        className={`flex-1 rounded-[18px] px-4 py-2.5 text-sm font-medium transition ${
                          !scheduleForm.active
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        One-off
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleFormTouched(true);
                          setScheduleForm((current) => ({ ...current, active: true }));
                        }}
                        className={`flex-1 rounded-[18px] px-4 py-2.5 text-sm font-medium transition ${
                          scheduleForm.active
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        Recurring
                      </button>
                    </div>
                  </div>
                  {scheduleForm.active ? (
                    <ManagedScheduleFields
                      value={scheduleForm}
                      onChange={(nextValue) => {
                        setScheduleFormTouched(true);
                        setScheduleForm(nextValue);
                      }}
                      showActiveToggle={false}
                    />
                  ) : (
                    <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600">
                      This class will stay one-off until you switch recurring back on.
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    {hasSavedSchedule ? (
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          setIsScheduleEditorOpen(false);
                          setScheduleFormTouched(false);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <div className="text-sm text-slate-600">Managed schedules can be edited later from this roster.</div>
                    )}
                    <Button
                      className="h-11"
                      onClick={() => void handleSaveSchedule()}
                      disabled={busyKey === "save-schedule"}
                    >
                      Save settings
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-600">
              <div className="font-medium text-slate-900">
                {scheduleDetails.externalLink
                  ? `Linked classroom: ${scheduleDetails.externalLink.externalClassroomId}`
                  : "No linked classroom yet"}
              </div>
              <div className="mt-1">
                {scheduleDetails.externalLink
                  ? `Sync status: ${scheduleDetails.externalLink.syncStatus.replaceAll("_", " ")}`
                  : "Tapcheck can still run one-off attendance while the upstream classroom link is pending."}
              </div>
            </div>
          )}

          {scheduleDetails.upcomingClassDays.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">Upcoming class days</div>
              <div className="space-y-2">
                {scheduleDetails.upcomingClassDays.map((classDay) => (
                  <div
                    key={classDay._id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-medium text-slate-900">{classDay.date}</div>
                      <div className="mt-1 text-slate-600">
                        {formatMinutes(classDay.startMinutes)} to {formatMinutes(classDay.endMinutes)}
                      </div>
                    </div>
                    <div className="text-right text-slate-600">
                      <div className="font-medium capitalize text-slate-900">{classDay.status}</div>
                      {classDay.linkedSessionStatus ? (
                        <div className="mt-1 capitalize">Attendance {classDay.linkedSessionStatus}</div>
                      ) : (
                        <div className="mt-1 capitalize">{classDay.source.replaceAll("_", " ")}</div>
                      )}
                      {isStandaloneRoster ? (
                        classDay.status === "scheduled" && classDay.linkedSessionStatus === null ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleClassDayStatusChange(
                                classDay.date,
                                "skipped",
                                `class-day-${classDay._id}-skip`,
                              )
                            }
                            disabled={busyKey === `class-day-${classDay._id}-skip`}
                            className="mt-2 text-sm font-medium text-amber-700 transition hover:text-amber-900"
                          >
                            Skip
                          </button>
                        ) : classDay.status === "skipped" && classDay.linkedSessionStatus === null ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleClassDayStatusChange(
                                classDay.date,
                                "scheduled",
                                `class-day-${classDay._id}-undo`,
                              )
                            }
                            disabled={busyKey === `class-day-${classDay._id}-undo`}
                            className="mt-2 text-sm font-medium text-slate-700 transition hover:text-slate-950"
                          >
                            Undo skip
                          </button>
                        ) : null
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Card className="border border-rose-200 bg-rose-50/90 px-5 py-4 text-sm text-rose-700">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden px-0 py-0">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="justify-self-start">
            <Link
              href={`/rosters/import?rosterId=${data.roster._id}`}
              className={buttonVariants({
                variant: "primary",
                className: "h-11 gap-2 bg-slate-800 px-4 hover:bg-slate-700",
              })}
            >
              <Pencil className="h-4 w-4" />
              <span>Edit Roster</span>
            </Link>
          </div>
          <div className="justify-self-center">
            <PresentTotalPill presentCount={presentCount} totalCount={totalCount} />
          </div>
          <div className="justify-self-end">
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              disabled={!sessionExport || isExporting}
              className={buttonVariants({
                variant: "primary",
                className: "h-11 gap-2 bg-slate-800 px-4 hover:bg-slate-700",
              })}
            >
              <Send className="h-4 w-4" />
              <span>{isExporting ? "Preparing" : "Attendance"}</span>
            </button>
          </div>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3">{renderSortLabel("First", "firstName")}</th>
                <th className="px-4 py-3">{renderSortLabel("Last", "lastName")}</th>
                <th className="px-4 py-3">{renderSortLabel("ID", "studentId")}</th>
                <th className="px-4 py-3">{renderSortLabel("Link", "linkStatus")}</th>
                <th className="px-4 py-3">{renderSortLabel("Status", "status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.firstName || "—"}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.lastName || student.displayName}</td>
                  <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                  <td className="px-4 py-3">
                    {student.linkStatus === "linked" ? (
                      <span aria-label="Linked" className="inline-flex items-center text-slate-600">
                        <Link2 className="h-4 w-4" />
                      </span>
                    ) : student.linkStatus === "unlinked" ? (
                      <span aria-label="Unlinked" className="inline-flex items-center text-slate-400">
                        <Link2Off className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(student.linkStatus)}`}>
                        {student.linkStatus.replace("_", " ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500">
                      {student.isPresent ? (
                        <span aria-label="Present">
                          <Check className="h-4 w-4 text-emerald-700" />
                        </span>
                      ) : null}
                      {student.linkStatus === "linked" ? (
                        <span aria-label="Linked">
                          <Link2 className="h-4 w-4 text-slate-600" />
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section>
        <Button
          variant="danger"
          onClick={() => setDeleteOpen(true)}
          className="h-11 w-full"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Delete roster
        </Button>
      </section>
    </PageShell>
  );
}
