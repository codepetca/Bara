import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { RosterImportForm } from "@/components/roster-import-form";
import { visualImportFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default function VisualImportPage() {
  ensureVisualRoutesEnabled();

  return (
    <PageShell title="Import roster" backHref="/" hideAuthControls>
      <Suspense fallback={<div className="h-56 animate-pulse rounded-[28px] bg-white/80" />}>
        <RosterImportForm fixturePreset={visualImportFixture} />
      </Suspense>
    </PageShell>
  );
}
