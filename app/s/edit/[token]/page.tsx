import { SessionAttendanceScreen } from "@/components/session-attendance-screen";
import { visualSessionFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default async function EditorAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (process.env.ENABLE_VISUAL_TEST_ROUTES === "1" && token === visualSessionFixture.session.checkInToken) {
    ensureVisualRoutesEnabled();
    return (
      <SessionAttendanceScreen
        token={token}
        hideAuthControls
        fixtureSession={visualSessionFixture}
      />
    );
  }

  return <SessionAttendanceScreen token={token} hideAuthControls />;
}
