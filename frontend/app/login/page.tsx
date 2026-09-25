"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { Button, Input, Card } from "@/components/ui";
import { MaritimeLogo, GoogleIcon, SpinnerIcon } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const { user, backendUser, loading, refreshBackendUser } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  // If already authenticated, redirect based on organization assignment
  useEffect(() => {
    if (!loading && user && backendUser) {
      if (backendUser.organization_id) {
        router.replace("/dashboard");
      } else {
        router.replace("/onboarding");
      }
    }
  }, [user, backendUser, loading, router]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || googleSubmitting) return;

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      const profile = await refreshBackendUser();
      if (profile?.organization_id) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSubmit = async () => {
    if (submitting || googleSubmitting) return;

    try {
      setGoogleSubmitting(true);
      setError(null);
      await signInWithPopup(auth, googleProvider);
      const profile = await refreshBackendUser();
      if (profile?.organization_id) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <SpinnerIcon size={28} className="text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Checking session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="flex justify-center">
          <MaritimeLogo size={44} />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          Maritime Nexus
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Sign in to access your chartering intelligence workspace
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="p-6 sm:p-8 shadow-sm">
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-700"
            >
              <div className="font-semibold mb-0.5">Authentication notice</div>
              {error}
            </div>
          )}

          {/* Google SSO Button */}
          <Button
            type="button"
            variant="outline"
            size="md"
            fullWidth
            onClick={handleGoogleSubmit}
            disabled={submitting || googleSubmitting}
            className="flex items-center justify-center gap-2.5 font-medium text-slate-700 bg-white hover:bg-slate-50 border-slate-300"
          >
            {googleSubmitting ? (
              <SpinnerIcon size={18} className="text-slate-500" />
            ) : (
              <GoogleIcon size={18} />
            )}
            <span>Continue with Google</span>
          </Button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400 font-medium tracking-wider">
                Or sign in with email
              </span>
            </div>
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              id="login-email"
              autoComplete="email"
              required
              placeholder="operator@shipping.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || googleSubmitting}
            />

            <Input
              label="Password"
              type="password"
              id="login-password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting || googleSubmitting}
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              disabled={submitting || googleSubmitting}
              className="mt-2"
            >
              {submitting ? (
                <>
                  <SpinnerIcon size={16} />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </Button>
          </form>

          {/* Sign up link */}
          <div className="mt-6 text-center text-xs text-slate-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Create an account
            </Link>
          </div>
        </Card>

        {/* Enterprise footer */}
        <p className="mt-6 text-center text-[11px] text-slate-400">
          Protected by enterprise-grade Firebase authentication and IAM protocols.
        </p>
      </div>
    </div>
  );
}
