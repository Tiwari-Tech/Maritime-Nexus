"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { MaritimeLogo, SpinnerIcon } from "@/components/icons";

export interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, backendUser, loading, backendError, refreshBackendUser, signOutUser } = useAuth();
  const router = useRouter();
  const [retrying, setRetrying] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (backendUser && backendUser.organization_id === null) {
      router.replace("/onboarding");
      return;
    }
  }, [user, backendUser, loading, router]);

  // Handle definitive backend sync failure: show recovery view with Retry and Sign Out
  if (!loading && user && !backendUser && backendError) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-900 p-4 select-none">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm w-full bg-white p-6 sm:p-8 rounded-xl border border-slate-200 shadow-sm">
          <MaritimeLogo size={44} />
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-slate-900">
              Workspace Connection Notice
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Unable to verify workspace permissions. The backend service may be temporarily unavailable.
            </p>
          </div>

          <div
            role="alert"
            className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 text-left font-medium"
          >
            {backendError}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 w-full pt-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  setRetrying(true);
                  await refreshBackendUser();
                } finally {
                  setRetrying(false);
                }
              }}
              disabled={retrying || signingOut}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {retrying && <SpinnerIcon size={13} />}
              <span>{retrying ? "Reconnecting..." : "Retry Connection"}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  setSigningOut(true);
                  await signOutUser();
                  router.replace("/login");
                } finally {
                  setSigningOut(false);
                }
              }}
              disabled={retrying || signingOut}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              {signingOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active initialization or genuine synchronization in progress
  if (loading || (user && !backendUser)) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-900 select-none">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <div className="relative flex items-center justify-center">
            <MaritimeLogo size={48} className="animate-pulse" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">
              Maritime Nexus
            </h2>
            <p className="text-xs text-slate-500">
              {loading ? "Verifying session..." : "Checking workspace permissions..."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-blue-600 font-medium">
            <SpinnerIcon size={16} />
            <span>Loading workspace</span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated or pending organization: render nothing while redirect is occurring
  if (!user || backendUser?.organization_id === null) {
    return null;
  }

  return <>{children}</>;
}
