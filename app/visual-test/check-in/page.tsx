import { StudentCheckInScreen } from "@/components/student-check-in-screen";
import {
  visualStudentCheckInFailureFixture,
  visualStudentCheckInFixture,
} from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default async function VisualStudentCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  ensureVisualRoutesEnabled();
  const { state } = await searchParams;
  const fixtureState =
    state === "failure" ? visualStudentCheckInFailureFixture : visualStudentCheckInFixture;

  return (
    <StudentCheckInScreen
      token="visual-check-in-token"
      fixtureState={fixtureState}
    />
  );
}
