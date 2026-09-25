"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MaritimeLogo,
  DashboardIcon,
  DocumentsIcon,
  AIAssistantIcon,
  VoyagesIcon,
  VesselsIcon,
  PortsIcon,
  ContractsIcon,
  SettingsIcon,
} from "@/components/icons";
import { MAIN_NAV_ITEMS, SECONDARY_NAV_ITEMS, NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function NavIcon({
  name,
  size = 18,
  className = "",
}: {
  name: NavItem["icon"];
  size?: number;
  className?: string;
}) {
  switch (name) {
    case "dashboard":
      return <DashboardIcon size={size} className={className} />;
    case "documents":
      return <DocumentsIcon size={size} className={className} />;
    case "ai-assistant":
      return <AIAssistantIcon size={size} className={className} />;
    case "voyages":
      return <VoyagesIcon size={size} className={className} />;
    case "vessels":
      return <VesselsIcon size={size} className={className} />;
    case "ports":
      return <PortsIcon size={size} className={className} />;
    case "contracts":
      return <ContractsIcon size={size} className={className} />;
    case "settings":
      return <SettingsIcon size={size} className={className} />;
    default:
      return null;
  }
}

export interface SidebarProps {
  className?: string;
  onItemClick?: () => void;
}

export function SidebarContent({ onItemClick }: { onItemClick?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col justify-between">
      {/* Brand & Main Navigation */}
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200/80">
          <MaritimeLogo size={30} className="shrink-0" />
          <div className="min-w-0">
            <span className="block font-bold text-slate-900 tracking-tight text-base leading-tight">
              Maritime Nexus
            </span>
            <span className="block text-[11px] font-semibold text-slate-600 tracking-wider uppercase">
              Operations Platform
            </span>
          </div>
        </div>

        {/* Primary Navigation */}
        <div className="px-3">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            Main Navigation
          </p>
          <nav aria-label="Primary Navigation" className="space-y-1">
            {MAIN_NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onItemClick}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                  )}
                >
                  <NavIcon
                    name={item.icon}
                    className={cn(
                      "shrink-0 transition-colors",
                      isActive
                        ? "text-blue-600"
                        : "text-slate-400 group-hover:text-slate-600"
                    )}
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Lower Navigation & Status Footer */}
      <div className="space-y-4 px-3 pb-4">
        <div className="pt-3 border-t border-slate-200/80">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            Management
          </p>
          <nav aria-label="Management Navigation" className="space-y-1">
            {SECONDARY_NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onItemClick}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                  )}
                >
                  <NavIcon
                    name={item.icon}
                    className={cn(
                      "shrink-0 transition-colors",
                      isActive
                        ? "text-blue-600"
                        : "text-slate-400 group-hover:text-slate-600"
                    )}
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Environment / System Tag */}
        <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-2 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700">Environment</span>
            <span className="font-mono text-[10px] bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded font-medium">
              MVP v0.1.0
            </span>
          </div>
          <p className="text-[11px] text-slate-600 mt-1">
            B2B Maritime Infrastructure
          </p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      aria-label="Sidebar Navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200/90 bg-white md:flex md:flex-col",
        className
      )}
    >
      <SidebarContent />
    </aside>
  );
}
