import { SessionDisplayScreen } from "@/components/session-display-screen";
import { visualDisplayFixture, visualSessionFixture } from "@/lib/visual-fixtures";
import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";

export default async function SharedDisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (process.env.ENABLE_VISUAL_TEST_ROUTES === "1" && token === visualSessionFixture.session.checkInToken) {
    ensureVisualRoutesEnabled();
    return <SessionDisplayScreen token={token} fixtureDisplay={visualDisplayFixture} />;
  }

  return <SessionDisplayScreen token={token} />;
}
