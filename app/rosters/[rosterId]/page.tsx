"use client";

import Papa from "papaparse";
import { Check, Copy, ExternalLink, Link2, Link2Off, Pencil, Play, Send, Square, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import {
  buildAbsoluteUrl,
  buildSessionDisplayPath,
  buildStaffSessionPath,
  getConfiguredAppOrigin,
} from "@/lib/session-links";

type SortColumn = "firstName" | "lastName" | "studentId" | "linkStatus" | "status";
type SortDirection = "asc" | "desc";

type SplitLinkActionProps = {
  href: string;
  label: string;
  openLabel: string;
  copyLabel: string;
  copyValue: string;
  copied: boolean;
  disabled?: boolean;
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

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function SplitLinkAction({
  href,
  label,
  openLabel,
  copyLabel,
  copyValue,
  copied,
  disabled = false,
  onCopy,
}: SplitLinkActionProps) {
  const openClassName = buttonVariants({
    variant: "primary",
    className:
      "h-14 min-w-0 flex-1 justify-start rounded-r-none bg-slate-800 px-4 hover:bg-slate-700",
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
        </span>
      ) : (
        <Link href={href} aria-label={openLabel} className={openClassName}>
          <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
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
  const data = useQuery(api.rosters.getById, { rosterId: rosterId as Id<"rosters"> });
  const renameRoster = useMutation(api.rosters.rename);
  const deleteRoster = useMutation(api.rosters.remove);
  const startSession = useMutation(api.sessions.start);
  const closeSession = useMutation(api.sessions.close);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [copiedAction, setCopiedAction] = useState<"manual" | "terminal" | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isDeleting = busyKey === "delete";
  const configuredOrigin = getConfiguredAppOrigin();
  const [runtimeOrigin, setRuntimeOrigin] = useState(configuredOrigin ?? "");

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
        date: today(),
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
    if (configuredOrigin || typeof window === "undefined") {
      return;
    }

    setRuntimeOrigin(window.location.origin);
  }, [configuredOrigin]);

  if (data === undefined) {
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
  const manualPath = latestSession ? buildStaffSessionPath(data.roster._id, latestSession._id) : "";
  const terminalPath = latestSession ? buildSessionDisplayPath(data.roster._id, latestSession._id) : "";
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
    window.setTimeout(() => setCopiedAction((current) => (current === action ? null : current)), 1800);
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
            <div className="grid grid-cols-2 gap-2">
              <SplitLinkAction
                href={manualPath}
                label="Manual Attendance"
                openLabel="Open manual attendance"
                copyLabel="Copy manual attendance link"
                copyValue={manualUrl}
                copied={copiedAction === "manual"}
                disabled={!latestSession}
                onCopy={() => void handleCopyAction("manual", manualUrl)}
              />
              <SplitLinkAction
                href={terminalPath}
                label="Attendance QR"
                openLabel="Open attendance QR"
                copyLabel="Copy attendance QR link"
                copyValue={terminalUrl}
                copied={copiedAction === "terminal"}
                disabled={!latestSession}
                onCopy={() => void handleCopyAction("terminal", terminalUrl)}
              />
            </div>
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
            <div className="grid grid-cols-2 gap-2">
              <SplitLinkAction
                href={manualPath}
                label="Manual Attendance"
                openLabel="Open manual attendance"
                copyLabel="Copy manual attendance link"
                copyValue={manualUrl}
                copied={copiedAction === "manual"}
                disabled={!latestSession}
                onCopy={() => void handleCopyAction("manual", manualUrl)}
              />
              <SplitLinkAction
                href={terminalPath}
                label="Attendance QR"
                openLabel="Open attendance QR"
                copyLabel="Copy attendance QR link"
                copyValue={terminalUrl}
                copied={copiedAction === "terminal"}
                disabled={!latestSession}
                onCopy={() => void handleCopyAction("terminal", terminalUrl)}
              />
            </div>
          </>
        )}
      </Card>

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
            {latestSessionId ? (
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
                <span>{isExporting ? "Preparing CSV" : "Attendance CSV"}</span>
              </button>
            ) : null}
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
