"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { createOrganization } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { Button, Input, Card } from "@/components/ui";
import { MaritimeLogo, LogoutIcon, SpinnerIcon } from "@/components/icons";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, backendUser, loading, backendError, refreshBackendUser, signOutUser } = useAuth();

  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Deterministic Route Protection
  useEffect(() => {
    if (loading) return;

    // State A: Unauthenticated user -> redirect to /login
    if (!user) {
      router.replace("/login");
      return;
    }

    // State D: User already belongs to an organization -> redirect to /dashboard
    if (backendUser && backendUser.organization_id !== null) {
      router.replace("/dashboard");
    }
  }, [user, backendUser, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmed = orgName.trim();

    // Client-side validation
    if (!trimmed) {
      setError("Please enter an organization name.");
      return;
    }
    if (trimmed.length < 2) {
      setError("Organization name must be at least 2 characters long.");
      return;
    }
    if (trimmed.length > 100) {
      setError("Organization name must not exceed 100 characters.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // 1. Call real backend organization creation endpoint
      await createOrganization({ name: trimmed });

      // 2. Synchronize fresh authenticated user state from GET /api/v1/auth/me
      const profile = await refreshBackendUser();

      // 3. Ensure organization association exists before routing to dashboard
      if (profile && profile.organization_id) {
        router.push("/dashboard");
      } else {
        setError("Organization created, but profile synchronization is pending. Please refresh.");
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr?.response?.status === 409) {
        setError("Your account already belongs to an organization.");
        const profile = await refreshBackendUser();
        if (profile?.organization_id) {
          router.push("/dashboard");
          return;
        }
      } else if (axiosErr?.response?.status === 401) {
        setError("Your session has expired. Please sign in again.");
        router.replace("/login");
        return;
      } else {
        setError(getApiErrorMessage(err, "Failed to create organization. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    try {
      setSigningOut(true);
      await signOutUser();
      router.push("/login");
    } catch (err) {
      console.error("Failed to sign out from onboarding:", err);
      setSigningOut(false);
    }
  };

  // Handle definitive backend sync failure: show recovery view with Retry and Sign Out
  if (!loading && user && !backendUser && backendError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 select-none">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm w-full bg-white p-6 sm:p-8 rounded-xl border border-slate-200 shadow-sm">
          <MaritimeLogo size={44} />
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-slate-900">
              Workspace Connection Notice
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Unable to verify organization status. The backend service may be temporarily unavailable.
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
              onClick={handleSignOut}
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

  // Session resolution loading state
  if (loading || (user && !backendUser)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <SpinnerIcon size={28} className="text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Checking organization status...</p>
        </div>
      </div>
    );
  }

  // Not authenticated or already assigned: render nothing while redirect is occurring
  if (!user || backendUser?.organization_id !== null) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <MaritimeLogo size={44} />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          Set up your organization
        </h1>
        <p className="mt-1.5 text-center text-sm text-slate-500 leading-relaxed">
          Create your organization workspace to continue using Maritime Nexus chartering and operations intelligence.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="p-6 sm:p-8 shadow-sm">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-700"
            >
              <div className="font-semibold mb-0.5">Notice</div>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Organization Name"
              type="text"
              id="onboarding-org-name"
              required
              maxLength={100}
              placeholder="e.g. Pacific Bulk Maritime"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={submitting}
              helperText="This workspace will organize your vessel tracking, documents, and contracts."
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              disabled={submitting || !orgName.trim()}
              className="mt-2"
            >
              {submitting ? (
                <>
                  <SpinnerIcon size={16} />
                  <span>Creating Organization...</span>
                </>
              ) : (
                <span>Create Organization</span>
              )}
            </Button>
          </form>

          {/* User identifier and Sign out */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="truncate max-w-[200px]" title={user.email || undefined}>
              {user.email}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-red-600 transition-colors cursor-pointer disabled:opacity-50"
            >
              {signingOut ? <SpinnerIcon size={12} /> : <LogoutIcon size={12} />}
              <span>Sign out</span>
            </button>
          </div>
        </Card>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          As the creator, you will be assigned as the organization administrator.
        </p>
      </div>
    </div>
  );
}
