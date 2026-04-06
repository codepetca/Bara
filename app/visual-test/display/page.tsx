import { SessionDisplayScreen } from "@/components/session-display-screen";
import { visualDisplayFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default function VisualDisplayPage() {
  ensureVisualRoutesEnabled();

  return <SessionDisplayScreen sessionId="visual-session" fixtureDisplay={visualDisplayFixture} />;
}
