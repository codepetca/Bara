import { StudentCheckInScreen } from "@/components/student-check-in-screen";
import { visualStudentCheckInFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default function VisualStudentCheckInPage() {
  ensureVisualRoutesEnabled();

  return (
    <StudentCheckInScreen
      token="visual-check-in-token"
      fixtureState={visualStudentCheckInFixture}
    />
  );
}
