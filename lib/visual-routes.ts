import { notFound } from "next/navigation";

export function ensureVisualRoutesEnabled() {
  if (process.env.ENABLE_VISUAL_TEST_ROUTES !== "1") {
    notFound();
  }
}
