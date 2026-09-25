"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MenuIcon, MaritimeLogo, LogoutIcon, SpinnerIcon } from "@/components/icons";
import { getNavItemByPath } from "@/lib/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/utils";

export interface HeaderProps {
  onOpenMobileNav?: () => void;
  className?: string;
}

export function Header({ onOpenMobileNav, className }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, backendUser, signOutUser } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const currentNav = getNavItemByPath(pathname);

  const displayName =
    backendUser?.full_name || user?.displayName || user?.email?.split("@")[0] || "Operator";
  const email = user?.email || backendUser?.email || "";

  const initials = (() => {
    const sourceName = backendUser?.full_name || user?.displayName;
    if (sourceName) {
      const parts = sourceName.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "MN";
  })();

  const handleSignOut = async () => {
    if (signingOut) return;
    try {
      setSigningOut(true);
      await signOutUser();
      router.push("/login");
    } catch (err) {
      console.error("Sign out failed:", err);
      setSigningOut(false);
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur-xs sm:px-6 lg:px-8",
        className
      )}
    >
      {/* Left: Mobile Menu Button & Current Page Breadcrumb/Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:hidden cursor-pointer"
        >
          <MenuIcon size={20} />
        </button>

        {/* Mobile Brand (visible only when sidebar is hidden) */}
        <div className="flex items-center gap-2 md:hidden">
          <MaritimeLogo size={22} className="shrink-0" />
          <span className="font-bold text-slate-900 text-sm tracking-tight">
            Maritime Nexus
          </span>
          <span className="text-slate-300">/</span>
        </div>

        {/* Section Title on Desktop */}
        <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500">
          <span className="text-slate-400">Workspace</span>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-900 truncate">
            {currentNav?.name || "Overview"}
          </span>
        </div>
      </div>

      {/* Right: Authenticated user status and actions */}
      <div className="flex items-center gap-3">
        {/* Environment status indicator */}
        <div className="hidden lg:flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/70 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>System Online</span>
        </div>

        {/* Real User Profile area */}
        <div
          aria-label="User profile"
          className="flex items-center gap-2.5 pl-2 select-none"
        >
          <div
            title={displayName}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-bold ring-2 ring-slate-200 shadow-xs"
          >
            {initials}
          </div>
          <div className="hidden sm:flex flex-col text-left max-w-[140px] md:max-w-[200px]">
            <span className="text-xs font-semibold text-slate-800 leading-tight truncate">
              {displayName}
            </span>
            <span className="text-[10px] text-slate-400 leading-tight truncate">
              {backendUser?.role ? `${email} • ${backendUser.role.toUpperCase()}` : email || "Authenticated"}
            </span>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          title="Sign out of Maritime Nexus"
          aria-label="Sign out"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 transition-colors cursor-pointer disabled:opacity-50"
        >
          {signingOut ? (
            <SpinnerIcon size={14} className="text-rose-600" />
          ) : (
            <LogoutIcon size={14} />
          )}
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
}
