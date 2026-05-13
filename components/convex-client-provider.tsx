"use client";

import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import { useCallback, useMemo, useState } from "react";

function useAuthFromAuthKit() {
  const { user, loading: isAuthLoading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const userId = user?.id;

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!userId) {
        return null;
      }

      try {
        const token = forceRefreshToken ? await refresh() : await getAccessToken();
        return token ?? null;
      } catch {
        return null;
      }
    },
    [getAccessToken, refresh, userId],
  );

  return useMemo(
    () => ({
      isLoading: isAuthLoading,
      isAuthenticated: Boolean(userId),
      fetchAccessToken,
    }),
    [fetchAccessToken, isAuthLoading, userId],
  );
}

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const [client] = useState(() => (url ? new ConvexReactClient(url) : null));

  if (!client) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4 py-8">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-6 py-8 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">Setup required</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            Add your Convex deployment URL.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Set <code className="rounded bg-slate-100 px-1.5 py-0.5">NEXT_PUBLIC_CONVEX_URL</code> in{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.local</code>, then restart the app.
          </p>
        </div>
      </main>
    );
  }

  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={client} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
