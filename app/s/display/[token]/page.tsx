import { notFound } from "next/navigation";
import { SessionDisplayScreen } from "@/components/session-display-screen";
import { visualDisplayFixture, visualSessionFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default async function SharedDisplayPage({
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
    return <SessionDisplayScreen token={token} fixtureDisplay={visualDisplayFixture} />;
  }

  return <SessionDisplayScreen token={token} />;
}
