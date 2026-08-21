import { SessionAttendanceScreen } from "@/components/session-attendance-screen";
import { visualSessionFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default function VisualSessionPage() {
  ensureVisualRoutesEnabled();

  return (
    <SessionAttendanceScreen
      rosterId="visual-roster"
      sessionId="visual-session"
      hideAuthControls
      fixtureSession={visualSessionFixture}
    />
  );
}
