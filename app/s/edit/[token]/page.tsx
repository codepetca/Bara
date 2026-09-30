import { notFound } from "next/navigation";
import { SessionAttendanceScreen } from "@/components/session-attendance-screen";
import { visualSessionFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default async function EditorAttendancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Reject the synthetic student capability without contacting a backend.
  // Real tokens still use the normal query path, including when fixtures are enabled.
  if (process.env.ENABLE_VISUAL_TEST_ROUTES === "1" && token === visualSessionFixture.session.checkInToken) {
    notFound();
  }

  if (process.env.ENABLE_VISUAL_TEST_ROUTES === "1" && token === visualSessionFixture.session.staffShareToken) {
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
