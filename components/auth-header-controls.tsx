"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AUTH_ROUTE_PATHS } from "@/lib/auth-routes";

export function AuthHeaderControls() {
  const pathname = usePathname();
  const { user, loading, signOut } = useAuth();

  if (pathname && AUTH_ROUTE_PATHS.has(pathname)) {
    return null;
  }

  if (loading) {
    return <div aria-label="Loading account" className="h-10 w-20 animate-pulse rounded-full bg-slate-100" />;
  }

  return (
    <div className="flex items-center gap-2">
      {user ? (
        <button
          type="button"
          onClick={() => void signOut({ returnTo: "/" })}
          className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
        >
          Sign out
        </button>
      ) : (
        <>
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Sign up
          </Link>
        </>
      )}
    </div>
  );
}
