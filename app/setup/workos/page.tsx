import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { getWorkosEnvStatus } from "@/lib/workos-config";

function StatusPill({ tone, children }: { tone: "success" | "warning"; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        tone === "success"
          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {children}
    </span>
  );
}

export default function WorkosSetupPage() {
  const status = getWorkosEnvStatus();

  return (
    <PageShell
      title="WorkOS setup"
      subtitle="Tapcheck is wired for WorkOS AuthKit, but local environment variables are still missing."
      hideAuthControls
    >
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
              AuthKit environment
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Add the missing values to the shared Tapcheck `.env.local`, then restart `pnpm dev`.
            </p>
          </div>
          <StatusPill tone={status.isReady ? "success" : "warning"}>
            {status.isReady ? "Ready" : "Missing config"}
          </StatusPill>
        </div>

        <div className="mt-5 space-y-3">
          {status.variables.map((variable) => (
            <div
              key={variable.name}
              className="rounded-[22px] border border-slate-200 bg-white/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {variable.name}
                </code>
                <StatusPill tone={variable.isMissing ? "warning" : "success"}>
                  {variable.isMissing ? "Missing" : "Set"}
                </StatusPill>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{variable.description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
          WorkOS dashboard checklist
        </h2>
        <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
          <p>
            1. Add local redirect URIs for every dev port you use, for example
            `http://localhost:3000/callback` through `http://localhost:3004/callback`.
          </p>
          <p>2. Set the sign-in endpoint to `http://localhost:3000/sign-in` for dashboard-initiated sign-in.</p>
          <p>3. Generate a cookie password with `openssl rand -base64 32`.</p>
          <p>4. Keep `WORKOS_API_KEY` server-only. Do not prefix it with `NEXT_PUBLIC_`.</p>
          <p>5. Ensure Convex dev env has the same `WORKOS_CLIENT_ID`.</p>
        </div>
      </Card>
    </PageShell>
  );
}
