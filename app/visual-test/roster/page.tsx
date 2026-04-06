import Link from "next/link";
import { Check, Link2, Link2Off, Pencil, QrCode, Send, Square, Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VisualSplitLinkAction } from "@/components/visual-split-link-action";
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

export default function VisualRosterPage() {
  ensureVisualRoutesEnabled();

  return (
    <PageShell title={visualRosterFixture.roster.name} backHref="/" hideAuthControls>
      <Card className="space-y-3">
        <Button variant="warning" className="h-14 w-full text-base">
          <Square className="mr-2 h-4 w-4" />
          Close Attendance
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <VisualSplitLinkAction
            href={`/s/edit/${visualRosterFixture.activeSession.checkInToken}`}
            label="Tap Attendance"
            copyLabel="Copy manual attendance link"
          />
          <VisualSplitLinkAction
            href={`/s/display/${visualRosterFixture.activeSession.checkInToken}`}
            label="QR Attendance"
            copyLabel="Copy attendance QR link"
            trailingIcon={<QrCode className="ml-2 h-4 w-4 shrink-0" />}
          />
        </div>
      </Card>

      <Card className="overflow-hidden px-0 py-0">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="justify-self-start">
            <Link
              href={`/rosters/import?rosterId=${visualRosterFixture.roster._id}`}
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
            <PresentTotalPill
              presentCount={visualRosterFixture.students.filter((student) => student.isPresent).length}
              totalCount={visualRosterFixture.students.length}
            />
          </div>
          <div className="justify-self-end">
            <button
              type="button"
              className={buttonVariants({
                variant: "primary",
                className: "h-11 gap-2 bg-slate-800 px-4 hover:bg-slate-700",
              })}
            >
              <Send className="h-4 w-4" />
              <span>Attendance</span>
            </button>
          </div>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3">
                  <span className="font-medium text-slate-600">First</span>
                </th>
                <th className="px-4 py-3">
                  <span className="font-medium text-slate-600">Last</span>
                </th>
                <th className="px-4 py-3">
                  <span className="font-medium text-slate-600">ID</span>
                </th>
                <th className="px-4 py-3">
                  <span className="font-medium text-slate-600">Link</span>
                </th>
                <th className="px-4 py-3">
                  <span className="font-medium text-slate-600">Status</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visualRosterFixture.students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.firstName}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.lastName}</td>
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
                      {student.isPresent ? <Check className="h-4 w-4 text-emerald-700" aria-label="Present" /> : null}
                      {student.linkStatus === "linked" ? (
                        <Link2 className="h-4 w-4 text-slate-600" aria-label="Linked" />
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
        <Button variant="danger" className="h-11 w-full">
          <Trash2 className="mr-1 h-4 w-4" />
          Delete roster
        </Button>
      </section>
    </PageShell>
  );
}
