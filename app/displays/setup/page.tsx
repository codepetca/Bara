import type { Metadata } from "next";
import { DisplayAdmin } from "@/components/display-admin";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function DisplaySetupPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <DisplayAdmin setup initialCode={typeof code === "string" ? code : ""} />;
}
