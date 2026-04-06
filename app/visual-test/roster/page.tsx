import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { visualRosterFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

function getLinkStatusClasses(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "linked") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "ambiguous" || status === "review_needed") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-600";
}

function getLatestStatusClasses(tone: "present" | "absent" | "loading" | "idle") {
  if (tone === "present") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (tone === "absent") {
    return "bg-rose-100 text-rose-700";
  }

  if (tone === "loading") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-600";
}

export default function VisualRosterPage() {
  ensureVisualRoutesEnabled();

  return (
    <PageShell title={visualRosterFixture.roster.name} backHref="/" hideAuthControls>
      <Link href={`/rosters/${visualRosterFixture.roster._id}/sessions/${visualRosterFixture.activeSession._id}`} className="block">
        <Button className="h-14 w-full text-base">
          Open Attendance
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </Link>

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
              {visualRosterFixture.students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.displayName}</td>
                  <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(student.linkStatus)}`}>
                      {student.linkStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLatestStatusClasses(student.latestStatusTone)}`}>
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
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Delete roster
        </button>
      </section>
    </PageShell>
  );
}
