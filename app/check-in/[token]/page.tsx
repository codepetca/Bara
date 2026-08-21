import { withAuth } from "@workos-inc/authkit-nextjs";
import { StudentCheckInScreen } from "@/components/student-check-in-screen";

export default async function StudentCheckInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await withAuth({ ensureSignedIn: true });

  return <StudentCheckInScreen token={token} />;
}
