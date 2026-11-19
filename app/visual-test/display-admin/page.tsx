import { ensureVisualRoutesEnabled } from "@/lib/visual-routes";
import { DisplayAdminFixture } from "./preview";

export default async function VisualDisplayAdminPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  ensureVisualRoutesEnabled();
  const { state } = await searchParams;
  return <DisplayAdminFixture state={state} />;
}
