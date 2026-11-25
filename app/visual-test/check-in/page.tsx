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
  const fixtureState = state === "invalid"
    ? { context: null, result: null, error: null, bootstrapError: null, isReady: true }
    : state === "failure" ? visualStudentCheckInFailureFixture : visualStudentCheckInFixture;

  return (
    <StudentCheckInScreen
      token="visual-check-in-token"
      fixtureState={fixtureState}
    />
  );
}
