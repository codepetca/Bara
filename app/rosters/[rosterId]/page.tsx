"use client";

import { ArrowRight, Pencil, Play, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getStudentSessionStatus } from "@/lib/roster-status";
import { buildStaffSessionPath } from "@/lib/session-links";

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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDeleting = busyKey === "delete";

  const latestSessionId = data?.sessions[0]?._id;
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
      const sessionId = await startSession({
        rosterId: data.roster._id,
        date: today(),
      });
      router.push(buildStaffSessionPath(data.roster._id, sessionId));
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start session.");
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
  const students = data.students.map((student) => {
    const present = attendanceByStudentId.get(student.studentId);
    const status = getStudentSessionStatus({
      hasLatestSession: Boolean(latestSessionId),
      isSessionExportLoading: latestSessionId !== undefined && sessionExport === undefined,
      present,
    });

    return {
      ...student,
      latestStatusLabel: status.label,
      latestStatusTone: status.tone,
    };
  });

  return (
    <PageShell
      title={
        isEditingTitle ? (
          <div className="space-y-3">
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="font-heading h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-2xl font-semibold tracking-tight text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleRename()} disabled={busyKey === "rename"}>
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditingTitle(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <span>{data.roster.name}</span>
            <button
              type="button"
              onClick={() => {
                setDraftTitle(data.roster.name);
                setIsEditingTitle(true);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
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

      {activeSession ? (
        <Link href={buildStaffSessionPath(data.roster._id, activeSession._id)} className="block">
          <Button className="h-14 w-full text-base">
            Open Attendance
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      ) : (
        <Button
          className="h-14 w-full text-base"
          onClick={() => void handleStartSession()}
          disabled={busyKey === "start" || data.students.length === 0}
        >
          <Play className="mr-2 h-4 w-4 fill-current" />
          Start Attendance
        </Button>
      )}

      {error ? (
        <Card className="border border-rose-200 bg-rose-50/90 px-5 py-4 text-sm text-rose-700">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden px-0 py-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
            Participants
          </h2>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="px-4 py-3 font-medium text-slate-600">ID</th>
                <th className="px-4 py-3 font-medium text-slate-600">Link</th>
                <th className="px-4 py-3 font-medium text-slate-600">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.displayName}</td>
                  <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(student.linkStatus)}`}>
                      {student.linkStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        student.latestStatusTone === "present"
                          ? "bg-emerald-100 text-emerald-800"
                          : student.latestStatusTone === "absent"
                            ? "bg-rose-100 text-rose-700"
                            : student.latestStatusTone === "loading"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {student.latestStatusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 transition hover:border-rose-400 hover:text-rose-800"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Delete roster
        </button>
      </section>
    </PageShell>
  );
}
