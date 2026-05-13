"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AUTH_ROUTE_PATHS, SIGN_IN_URL, SIGN_UP_URL } from "@/lib/auth-routes";

export function AuthHeaderControls() {
  const pathname = usePathname();
  const { loading, signOut, user } = useAuth();
  const handleSignOut = () => {
    void signOut({ returnTo: window.location.origin });
  };

  if (pathname && AUTH_ROUTE_PATHS.has(pathname)) {
    return null;
  }

  if (loading) {
    return (
      <div
        aria-label="Loading account controls"
        className="h-10 w-24 animate-pulse rounded-full bg-slate-200"
      />
    );
  }

  if (user) {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
      >
        Sign out
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={SIGN_IN_URL}
        className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
      >
        Sign in
      </Link>
      <Link
        href={SIGN_UP_URL}
        className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        Sign up
      </Link>
    </div>
  );
}
