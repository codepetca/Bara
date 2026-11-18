import { DisplayAdmin } from "@/components/display-admin";

export default async function DisplaysPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const { organizationId } = await searchParams;
  return <DisplayAdmin initialOrganizationId={organizationId} />;
}
