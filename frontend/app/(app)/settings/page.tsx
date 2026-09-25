"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { getApiErrorMessage } from "@/lib/api-errors";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  LogoutIcon,
  RefreshIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
} from "@/components/icons";

export default function SettingsPage() {
  const router = useRouter();
  const { user, backendUser, signOutUser, refreshBackendUser } = useAuth();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleRefreshProfile = async () => {
    try {
      setIsRefreshing(true);
      setFeedback(null);
      await refreshBackendUser();
      setFeedback({
        type: "success",
        message: "Profile synchronized successfully from backend.",
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to synchronize profile from backend."),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    try {
      setIsSendingReset(true);
      setFeedback(null);
      await sendPasswordResetEmail(auth, user.email);
      setFeedback({
        type: "success",
        message: `Password reset instructions sent to ${user.email}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getAuthErrorMessage(err),
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signOutUser();
      router.push("/login");
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getAuthErrorMessage(err),
      });
      setIsSigningOut(false);
    }
  };

  const isPasswordProvider = user?.providerData.some(
    (p) => p.providerId === "password"
  );

  const roleVariant = (() => {
    const r = backendUser?.role?.toLowerCase();
    if (r === "admin") return "warning";
    if (r === "manager") return "info";
    if (r === "operator") return "success";
    return "secondary";
  })();

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Top Page Header */}
      <PageHeader
        title="Settings"
        description="Account credentials, organization profile, and active workspace parameters."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings" },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshProfile}
            disabled={isRefreshing}
            className="gap-1.5 text-xs"
            aria-label="Synchronize profile from backend"
          >
            <RefreshIcon size={13} className={isRefreshing ? "animate-spin" : ""} />
            <span>Re-sync Profile</span>
          </Button>
        }
      />

      {/* Global Notice / Feedback Banner */}
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between rounded-lg p-3.5 text-xs font-medium border ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer ml-3"
            aria-label="Dismiss notice"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* Section 1: User Profile (Read-Only Database Record) */}
      <Card className="p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">User Profile</h2>
            <p className="text-xs text-slate-500">
              Authenticated user details verified against the PostgreSQL database
            </p>
          </div>
          <Badge variant="outline" size="sm">
            Read-Only
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Full Name</span>
            <span className="font-semibold text-slate-800 text-sm block">
              {backendUser?.full_name || user?.displayName || "—"}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Email Address</span>
            <span className="font-mono text-slate-800 text-xs block truncate">
              {backendUser?.email || user?.email || "—"}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Assigned Role</span>
            <div className="flex items-center gap-2">
              <Badge variant={roleVariant} size="sm">
                {backendUser?.role?.toUpperCase() || "VIEWER"}
              </Badge>
              <span className="text-[11px] text-slate-400">
                (Database Controlled)
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Account Status</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-semibold text-slate-800">
                {backendUser?.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-[11px] text-slate-500 leading-relaxed">
          User roles and authorization permissions are governed strictly by the FastAPI backend (
          <code className="text-slate-700 font-mono">/api/v1/auth/me</code>). Role modifications require an organization administrator.
        </div>
      </Card>

      {/* Section 2: Organization & Multi-Tenancy (Read-Only) */}
      <Card className="p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Organization &amp; Tenancy</h2>
            <p className="text-xs text-slate-500">
              Multi-tenant workspace isolation and database identifiers
            </p>
          </div>
          <Badge variant="outline" size="sm">
            Read-Only
          </Badge>
        </div>

        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Organization Identifier (UUID)</span>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 font-mono text-[11px] text-slate-800 break-all select-all">
              {backendUser?.organization_id || "No Organization Associated"}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-slate-500 font-medium block">User Database ID</span>
              <div className="p-2 bg-slate-50 rounded border border-slate-200/80 font-mono text-[11px] text-slate-700 truncate select-all">
                {backendUser?.id || "—"}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-500 font-medium block">Firebase Subject UID</span>
              <div className="p-2 bg-slate-50 rounded border border-slate-200/80 font-mono text-[11px] text-slate-700 truncate select-all">
                {backendUser?.firebase_uid || user?.uid || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-[11px] text-slate-500 leading-relaxed">
          All document repository items, vector embeddings, and operational assets are strictly scoped to your organization ID in Cloud SQL PostgreSQL.
        </div>
      </Card>

      {/* Section 3: Account & Authentication (Firebase-Backed Controls) */}
      <Card className="p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Account &amp; Security</h2>
            <p className="text-xs text-slate-500">
              Authentication provider and session management powered by Firebase
            </p>
          </div>
          <Badge variant="info" size="sm">
            Firebase Auth
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Auth Provider</span>
            <span className="font-semibold text-slate-800 block">
              {isPasswordProvider ? "Email & Password" : "Google SSO"}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 font-medium block">Email Verification</span>
            <div className="flex items-center gap-1.5">
              {user?.emailVerified ? (
                <>
                  <CheckIcon size={14} className="text-emerald-600" />
                  <span className="font-semibold text-emerald-700">Verified</span>
                </>
              ) : (
                <span className="font-semibold text-amber-700">Pending Verification</span>
              )}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          {/* Password reset option for password users */}
          {isPasswordProvider && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePasswordReset}
              disabled={isSendingReset}
              className="text-xs"
            >
              {isSendingReset ? (
                <span className="inline-flex items-center gap-1.5">
                  <SpinnerIcon size={12} />
                  <span>Sending email...</span>
                </span>
              ) : (
                <span>Send Password Reset Email</span>
              )}
            </Button>
          )}

          {/* Sign out button */}
          <Button
            variant="danger"
            size="sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="gap-1.5 text-xs ml-auto"
            aria-label="Sign out from Maritime Nexus"
          >
            {isSigningOut ? (
              <>
                <SpinnerIcon size={13} />
                <span>Signing out...</span>
              </>
            ) : (
              <>
                <LogoutIcon size={13} />
                <span>Sign Out</span>
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
