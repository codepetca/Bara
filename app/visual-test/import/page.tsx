import { PageShell } from "@/components/page-shell";
import { RosterImportForm } from "@/components/roster-import-form";
import { visualImportFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default function VisualImportPage() {
  ensureVisualRoutesEnabled();

  return (
    <PageShell title="Import roster" backHref="/" hideAuthControls>
      <RosterImportForm fixturePreset={visualImportFixture} />
    </PageShell>
  );
}
