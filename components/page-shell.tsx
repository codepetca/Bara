import Link from "next/link";
import { House } from "lucide-react";
import { AuthHeaderControls } from "@/components/auth-header-controls";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PageShellProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleClassName?: string;
  titleContainerClassName?: string;
  headerClassName?: string;
  mainClassName?: string;
  backHref?: string;
  backLabel?: string;
  headerAction?: React.ReactNode;
  hideAuthControls?: boolean;
  children: React.ReactNode;
};

export function PageShell({
  title,
  subtitle,
  subtitleClassName,
  titleContainerClassName,
  headerClassName,
  mainClassName,
  headerAction,
  hideAuthControls = false,
  children,
}: PageShellProps) {
  return (
    <main className={`mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-2 sm:px-6 ${mainClassName ?? ""}`.trim()}>
      <Card as="header" className={`mb-4 px-4 py-3 backdrop-blur ${headerClassName ?? ""}`.trim()}>
        <div className="relative min-h-11">
          <Link
            href="/"
            aria-label="Home"
            title="Home"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className:
                "absolute -left-2 top-1/2 -translate-y-1/2 shrink-0 border-transparent shadow-none px-2 text-slate-600 hover:text-slate-900 sm:px-3",
            })}
          >
            <House aria-hidden="true" className="h-5 w-5 sm:h-4 sm:w-4" />
            <span className="sr-only">Home</span>
          </Link>
          <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {headerAction}
            {hideAuthControls ? null : <AuthHeaderControls />}
          </div>
          <div
            className={`${titleContainerClassName ?? "px-20"} text-center ${
              subtitle ? "" : "flex min-h-11 items-center justify-center"
            }`}
          >
            <h1 className="font-heading text-xl font-semibold tracking-tight text-slate-950">
              {title}
            </h1>
            {subtitle ? (
              <div className={`mt-1 max-w-2xl text-sm leading-5 text-slate-600 ${subtitleClassName ?? ""}`.trim()}>
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
    </main>
  );
}
