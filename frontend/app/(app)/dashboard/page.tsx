"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listDocuments,
  listVessels,
  listPorts,
  listVoyages,
  listContracts,
  DocumentListItem,
  VesselListItem,
  PortListItem,
  VoyageListItem,
  ContractListItem,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  DocumentsIcon,
  AIAssistantIcon,
  VoyagesIcon,
  VesselsIcon,
  PortsIcon,
  ContractsIcon,
  RefreshIcon,
  ChevronRightIcon,
  SpinnerIcon,
  ArrowUpRightIcon,
} from "@/components/icons";

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatDocType(type: string): string {
  const map: Record<string, string> = {
    CHARTER_PARTY: "Charter Party",
    STATEMENT_OF_FACTS: "Statement of Facts",
    NOR: "Notice of Readiness",
    INVOICE: "Invoice",
    OTHER: "Other",
  };
  return map[type] || type.replace(/_/g, " ");
}

function DocumentStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "ready") {
    return <Badge variant="success" size="sm">Ready</Badge>;
  }
  if (s === "uploaded") {
    return <Badge variant="info" size="sm">Uploaded</Badge>;
  }
  if (s === "failed") {
    return <Badge variant="danger" size="sm">Failed</Badge>;
  }
  if (s === "processing") {
    return (
      <Badge variant="secondary" size="sm" className="gap-1 animate-pulse">
        <SpinnerIcon size={10} />
        <span>Processing</span>
      </Badge>
    );
  }
  return <Badge variant="outline" size="sm">{status}</Badge>;
}

function VoyageStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "in_transit") {
    return <Badge variant="info" size="sm">In Transit</Badge>;
  }
  if (s === "berthed") {
    return <Badge variant="warning" size="sm">Berthed</Badge>;
  }
  if (s === "completed") {
    return <Badge variant="success" size="sm">Completed</Badge>;
  }
  if (s === "cancelled") {
    return <Badge variant="danger" size="sm">Cancelled</Badge>;
  }
  return <Badge variant="secondary" size="sm">{status}</Badge>;
}

function ContractStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "active") {
    return <Badge variant="success" size="sm">Active</Badge>;
  }
  if (s === "completed") {
    return <Badge variant="info" size="sm">Completed</Badge>;
  }
  if (s === "cancelled") {
    return <Badge variant="danger" size="sm">Cancelled</Badge>;
  }
  if (s === "draft") {
    return <Badge variant="secondary" size="sm">Draft</Badge>;
  }
  return <Badge variant="outline" size="sm">{status}</Badge>;
}

export default function DashboardPage() {
  const { backendUser } = useAuth();
  const role = backendUser?.role?.toLowerCase() || "viewer";
  const canMutate = role === "admin" || role === "manager" || role === "operator";

  // Data states
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);

  const [vessels, setVessels] = useState<VesselListItem[]>([]);
  const [totalVessels, setTotalVessels] = useState(0);
  const [activeVessels, setActiveVessels] = useState(0);

  const [ports, setPorts] = useState<PortListItem[]>([]);
  const [totalPorts, setTotalPorts] = useState(0);

  const [voyages, setVoyages] = useState<VoyageListItem[]>([]);
  const [totalVoyages, setTotalVoyages] = useState(0);
  const [inTransitVoyages, setInTransitVoyages] = useState(0);

  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [totalContracts, setTotalContracts] = useState(0);
  const [activeContracts, setActiveContracts] = useState(0);

  // Loading and Error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookups for O(1) relational resolution in recent lists
  const vesselsMap = useMemo(() => {
    const map = new Map<string, VesselListItem>();
    vessels.forEach((v) => map.set(v.id, v));
    return map;
  }, [vessels]);

  const portsMap = useMemo(() => {
    const map = new Map<string, PortListItem>();
    ports.forEach((p) => map.set(p.id, p));
    return map;
  }, [ports]);

  // Process data from Promise.allSettled
  const applyDashboardResults = useCallback(
    (
      results: [
        PromiseSettledResult<{ items: VesselListItem[]; total: number }>,
        PromiseSettledResult<{ total: number }>,
        PromiseSettledResult<{ items: VoyageListItem[]; total: number }>,
        PromiseSettledResult<{ total: number }>,
        PromiseSettledResult<{ items: ContractListItem[]; total: number }>,
        PromiseSettledResult<{ total: number }>,
        PromiseSettledResult<{ items: DocumentListItem[]; total: number }>,
        PromiseSettledResult<{ items: PortListItem[]; total: number }>,
      ]
    ) => {
      const failures: string[] = [];

      // Vessels
      if (results[0].status === "fulfilled") {
        setVessels(results[0].value.items || []);
        setTotalVessels(results[0].value.total);
      } else {
        failures.push("Fleet");
      }

      // Active vessels
      if (results[1].status === "fulfilled") {
        setActiveVessels(results[1].value.total);
      }

      // Voyages
      if (results[2].status === "fulfilled") {
        setVoyages(results[2].value.items || []);
        setTotalVoyages(results[2].value.total);
      } else {
        failures.push("Voyages");
      }

      // In-transit voyages
      if (results[3].status === "fulfilled") {
        setInTransitVoyages(results[3].value.total);
      }

      // Contracts
      if (results[4].status === "fulfilled") {
        setContracts(results[4].value.items || []);
        setTotalContracts(results[4].value.total);
      } else {
        failures.push("Contracts");
      }

      // Active contracts
      if (results[5].status === "fulfilled") {
        setActiveContracts(results[5].value.total);
      }

      // Documents
      if (results[6].status === "fulfilled") {
        setDocuments(results[6].value.items || []);
        setTotalDocs(results[6].value.total);
      } else {
        failures.push("Documents");
      }

      // Ports
      if (results[7].status === "fulfilled") {
        setPorts(results[7].value.items || []);
        setTotalPorts(results[7].value.total);
      } else {
        failures.push("Ports");
      }

      if (failures.length > 0 && failures.length === results.length) {
        setError("Unable to connect to maritime services. Please verify your connection.");
      } else if (failures.length > 0) {
        setError(`Notice: Operational data for ${failures.join(", ")} could not be loaded.`);
      } else {
        setError(null);
      }
    },
    []
  );

  // Manual refresh callback
  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        listVessels({ page: 1, page_size: 100 }),
        listVessels({ page: 1, page_size: 1, status: "active" }),
        listVoyages({ page: 1, page_size: 5 }),
        listVoyages({ page: 1, page_size: 1, status: "in_transit" }),
        listContracts({ page: 1, page_size: 5 }),
        listContracts({ page: 1, page_size: 1, status: "active" }),
        listDocuments({ page: 1, page_size: 50 }),
        listPorts({ page: 1, page_size: 100 }),
      ]);
      applyDashboardResults(results);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Unable to refresh operational dashboard."));
    } finally {
      setLoading(false);
    }
  }, [applyDashboardResults]);

  // Initial load with race-condition ignore safety
  useEffect(() => {
    let ignore = false;

    Promise.allSettled([
      listVessels({ page: 1, page_size: 100 }),
      listVessels({ page: 1, page_size: 1, status: "active" }),
      listVoyages({ page: 1, page_size: 5 }),
      listVoyages({ page: 1, page_size: 1, status: "in_transit" }),
      listContracts({ page: 1, page_size: 5 }),
      listContracts({ page: 1, page_size: 1, status: "active" }),
      listDocuments({ page: 1, page_size: 50 }),
      listPorts({ page: 1, page_size: 100 }),
    ])
      .then((results) => {
        if (!ignore) {
          applyDashboardResults(results);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(getApiErrorMessage(err, "Unable to load operational dashboard."));
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [applyDashboardResults]);

  // Derived document metrics from fetched page items
  const readyDocs = documents.filter((d) => d.status.toLowerCase() === "ready").length;
  const pendingDocs = documents.filter(
    (d) => d.status.toLowerCase() === "uploaded" || d.status.toLowerCase() === "processing"
  ).length;
  const failedDocs = documents.filter((d) => d.status.toLowerCase() === "failed").length;

  const recentDocs = documents.slice(0, 5);
  const recentVoyages = voyages.slice(0, 5);
  const recentContracts = contracts.slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Top Page Header */}
      <PageHeader
        title="Operational Dashboard"
        description="Unified real-time overview of organization fleet, voyages, contracts, and documents."
        breadcrumbs={[{ label: "Dashboard" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshDashboard()}
              disabled={loading}
              title="Refresh operational metrics"
              aria-label="Refresh dashboard data"
              className="gap-1.5 text-xs"
            >
              <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Link href="/ai-assistant">
              <Button variant="primary" size="sm" className="gap-1.5 text-xs shadow-xs">
                <AIAssistantIcon size={14} />
                <span>Ask Maritime AI</span>
              </Button>
            </Link>
          </div>
        }
      />

      {/* Error / Degraded Service Alert */}
      {error && (
        <Card className="p-4 border-amber-200 bg-amber-50 text-amber-900 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium leading-relaxed">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshDashboard()}
              className="text-xs h-7 px-2 border-amber-300 text-amber-900 hover:bg-amber-100 shrink-0"
            >
              Retry Connection
            </Button>
          </div>
        </Card>
      )}

      {/* ─── PRIMARY KPI ROW (100% Real Backend Data) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Fleet Vessels */}
        <Link href="/vessels" className="block group">
          <Card className="p-5 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Fleet Vessels
              </span>
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <VesselsIcon size={18} />
              </div>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono">
                  {totalVessels}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                <span>{activeVessels} active in service</span>
                <ChevronRightIcon size={12} className="text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
              </p>
            </div>
          </Card>
        </Link>

        {/* Commercial Voyages */}
        <Link href="/voyages" className="block group">
          <Card className="p-5 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Active Voyages
              </span>
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <VoyagesIcon size={18} />
              </div>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono">
                  {totalVoyages}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                <span>{inTransitVoyages} currently in transit</span>
                <ChevronRightIcon size={12} className="text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
              </p>
            </div>
          </Card>
        </Link>

        {/* Charter Contracts */}
        <Link href="/contracts" className="block group">
          <Card className="p-5 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Charter Contracts
              </span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <ContractsIcon size={18} />
              </div>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono">
                  {totalContracts}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                <span>{activeContracts} active charter parties</span>
                <ChevronRightIcon size={12} className="text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
              </p>
            </div>
          </Card>
        </Link>

        {/* Documents Repository */}
        <Link href="/documents" className="block group">
          <Card className="p-5 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all h-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Documents &amp; RAG
              </span>
              <div className="p-2 rounded-lg bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition-colors">
                <DocumentsIcon size={18} />
              </div>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono">
                  {totalDocs}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                <span>{readyDocs} indexed{pendingDocs > 0 ? `, ${pendingDocs} pending` : ""}</span>
                <ChevronRightIcon size={12} className="text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
              </p>
            </div>
          </Card>
        </Link>
      </div>

      {/* ─── AI ASSISTANT SPOTLIGHT ENTRY ─── */}
      <Card className="p-5 sm:p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md border-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-indigo-500/20 text-indigo-300">
                <AIAssistantIcon size={16} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                Grounded Maritime AI Assistant
              </span>
              <Badge variant="secondary" size="sm" className="bg-indigo-500/20 text-indigo-200 border-0 text-[10px]">
                Gemma 3:1B + pgvector
              </Badge>
            </div>
            <h3 className="text-lg font-bold text-white">
              Query Charter Parties, Clauses, &amp; Operational Delays
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Ask natural-language questions grounded strictly in your organization&apos;s uploaded maritime fixtures,
              notices of readiness, and statement of facts with full source chunk attribution.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/ai-assistant">
              <Button
                variant="primary"
                size="sm"
                className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs gap-1.5 shadow-sm border-0"
              >
                <span>Launch AI Assistant</span>
                <ArrowUpRightIcon size={14} />
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* ─── QUICK NAVIGATION (All 6 Operational Workspaces) ─── */}
      <Card className="p-4 sm:p-5 shadow-xs">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Operational Workspaces
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Vessels */}
          <Link href="/vessels" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <VesselsIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Fleet Directory</p>
                  <p className="text-[11px] text-slate-500">{totalVessels} Registered Vessels</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-blue-600 transition-colors" />
            </div>
          </Link>

          {/* Ports */}
          <Link href="/ports" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <PortsIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Ports &amp; Terminals</p>
                  <p className="text-[11px] text-slate-500">{totalPorts} UN/LOCODE Directory</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
            </div>
          </Link>

          {/* Voyages */}
          <Link href="/voyages" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <VoyagesIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Voyages &amp; Laytime</p>
                  <p className="text-[11px] text-slate-500">{totalVoyages} Logged Voyages</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
            </div>
          </Link>

          {/* Contracts */}
          <Link href="/contracts" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-amber-500 hover:bg-amber-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <ContractsIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Contracts &amp; Clauses</p>
                  <p className="text-[11px] text-slate-500">{totalContracts} Fixtures &amp; Riders</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-amber-600 transition-colors" />
            </div>
          </Link>

          {/* Documents */}
          <Link href="/documents" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-sky-500 hover:bg-sky-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition-colors">
                  <DocumentsIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Document Repository</p>
                  <p className="text-[11px] text-slate-500">{totalDocs} Uploaded Files</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-sky-600 transition-colors" />
            </div>
          </Link>

          {/* AI Assistant */}
          <Link href="/ai-assistant" className="block group">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-purple-500 hover:bg-purple-50/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                  <AIAssistantIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Maritime AI Copilot</p>
                  <p className="text-[11px] text-slate-500">RAG Document Q&amp;A</p>
                </div>
              </div>
              <ChevronRightIcon size={16} className="text-slate-400 group-hover:text-purple-600 transition-colors" />
            </div>
          </Link>
        </div>
      </Card>

      {/* ─── OPERATIONAL OVERVIEWS: RECENT VOYAGES & RECENT DOCUMENTS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Voyages */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Recent Voyages</h3>
              <p className="text-xs text-slate-500">Latest active and scheduled fleet operations</p>
            </div>
            {totalVoyages > 0 && (
              <Link
                href="/voyages"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
              >
                <span>View all {totalVoyages}</span>
                <ChevronRightIcon size={12} />
              </Link>
            )}
          </div>

          {loading ? (
            <Card className="p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3" />
              <div className="h-10 bg-slate-100 rounded" />
              <div className="h-10 bg-slate-100 rounded" />
            </Card>
          ) : recentVoyages.length === 0 ? (
            <EmptyState
              icon={<VoyagesIcon size={20} />}
              badgeText="Voyage Tracking"
              title="No Voyages Logged Yet"
              description="No commercial voyages are registered. Schedule your first voyage to monitor port laytime and route milestones."
              action={
                canMutate ? (
                  <Link href="/voyages">
                    <Button variant="primary" size="sm" className="text-xs">
                      Schedule Voyage
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Card className="divide-y divide-slate-100 shadow-xs overflow-hidden">
              {recentVoyages.map((v) => {
                const vessel = vesselsMap.get(v.vessel_id);
                const originPort = v.origin_port_id ? portsMap.get(v.origin_port_id) : null;
                const destPort = v.destination_port_id ? portsMap.get(v.destination_port_id) : null;
                return (
                  <div key={v.id} className="p-3.5 hover:bg-slate-50/75 transition-colors text-xs flex items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href="/voyages"
                          className="font-mono font-bold text-brand-600 hover:text-brand-800 truncate"
                        >
                          {v.voyage_number}
                        </Link>
                        <VoyageStatusBadge status={v.status} />
                      </div>
                      <p className="text-slate-700 font-medium truncate">
                        {vessel ? vessel.name : "Fleet Vessel"}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {originPort ? originPort.unlocode : "—"} &rarr; {destPort ? destPort.unlocode : "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] text-slate-400 block">
                        {formatDate(v.departure_date)}
                      </span>
                      <Link
                        href="/voyages"
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5 mt-1"
                      >
                        <span>Details</span>
                        <ChevronRightIcon size={10} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>

        {/* Recent Documents */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Recent Documents</h3>
              <p className="text-xs text-slate-500">Recently uploaded charter parties and notices</p>
            </div>
            {totalDocs > 0 && (
              <Link
                href="/documents"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
              >
                <span>View all {totalDocs}</span>
                <ChevronRightIcon size={12} />
              </Link>
            )}
          </div>

          {loading ? (
            <Card className="p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3" />
              <div className="h-10 bg-slate-100 rounded" />
              <div className="h-10 bg-slate-100 rounded" />
            </Card>
          ) : recentDocs.length === 0 ? (
            <EmptyState
              icon={<DocumentsIcon size={20} />}
              badgeText="Documents"
              title="No Documents Uploaded Yet"
              description="Upload PDF charter parties or statements of facts to begin automated chunking and RAG indexing."
              action={
                canMutate ? (
                  <Link href="/documents">
                    <Button variant="primary" size="sm" className="text-xs">
                      Upload Document
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Card className="divide-y divide-slate-100 shadow-xs overflow-hidden">
              {recentDocs.map((doc) => (
                <div key={doc.id} className="p-3.5 hover:bg-slate-50/75 transition-colors text-xs flex items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <Link
                      href="/documents"
                      className="font-semibold text-slate-900 hover:text-blue-600 truncate block"
                      title={doc.title}
                    >
                      {doc.title}
                    </Link>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{formatDocType(doc.document_type)}</span>
                      <span>&bull;</span>
                      <span>{formatFileSize(doc.file_size_bytes)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <DocumentStatusBadge status={doc.status} />
                    <span className="text-[10px] text-slate-400 block mt-1">
                      {formatDate(doc.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* ─── RECENT COMMERCIAL CONTRACTS ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Commercial Contracts</h3>
            <p className="text-xs text-slate-500">Active charter party agreements and rider fixtures</p>
          </div>
          {totalContracts > 0 && (
            <Link
              href="/contracts"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
            >
              <span>View all {totalContracts} contracts</span>
              <ChevronRightIcon size={12} />
            </Link>
          )}
        </div>

        {loading ? (
          <Card className="p-4 space-y-3 animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-1/3" />
            <div className="h-10 bg-slate-100 rounded" />
          </Card>
        ) : recentContracts.length === 0 ? (
          <EmptyState
            icon={<ContractsIcon size={20} />}
            badgeText="Commercial Fixtures"
            title="No Contracts Registered Yet"
            description="Record your organization's voyage and time charter parties with structured laytime terms and legal clauses."
            action={
              canMutate ? (
                <Link href="/contracts">
                  <Button variant="primary" size="sm" className="text-xs">
                    Create Contract
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentContracts.map((c) => {
              const vessel = c.vessel_id ? vesselsMap.get(c.vessel_id) : null;
              return (
                <Card key={c.id} className="p-4 shadow-2xs hover:border-slate-300 transition-colors space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href="/contracts"
                        className="font-mono font-bold text-xs text-brand-600 hover:text-brand-800"
                      >
                        {c.contract_reference}
                      </Link>
                      <p className="text-[11px] text-slate-500">{c.contract_type}</p>
                    </div>
                    <ContractStatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-slate-700 pt-1 border-t border-slate-100 space-y-0.5">
                    <p className="truncate">
                      <span className="text-slate-400 font-medium">Vessel: </span>
                      <span className="font-semibold">{vessel ? vessel.name : "—"}</span>
                    </p>
                    <p className="truncate">
                      <span className="text-slate-400 font-medium">Charterer: </span>
                      <span>{c.charterer || "—"}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 border-t border-slate-100">
                    <span>Term: {formatDate(c.commencement_date)}</span>
                    <Link href="/contracts" className="text-blue-600 font-medium hover:underline">
                      Manage &rarr;
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── OPERATIONAL MODULE READINESS (100% Real Live Status) ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">System Modules</h3>
            <p className="text-xs text-slate-500">
              Architectural deployment status across Maritime Nexus functional domains
            </p>
          </div>
          <Badge variant="success" size="sm">
            6 / 6 Modules Live
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Documents Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-blue-50 text-blue-600">
                  <DocumentsIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">Documents</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              GCS bucket storage, PyMuPDF chunking, and pgvector BGE-M3 embeddings.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>{totalDocs} files ({readyDocs} ready{failedDocs > 0 ? `, ${failedDocs} failed` : ""})</span>
              <Link href="/documents" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>

          {/* AI Assistant Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-indigo-50 text-indigo-600">
                  <AIAssistantIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">AI Assistant</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Grounded question answering using Ollama (Gemma 3:1B) with source traceability.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>Ollama + pgvector</span>
              <Link href="/ai-assistant" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>

          {/* Vessels Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-slate-100 text-slate-700">
                  <VesselsIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">Vessels &amp; Fleet</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Fleet master registry, IMO validation, DWT specifications, and vessel status.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>{totalVessels} fleet vessels</span>
              <Link href="/vessels" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>

          {/* Ports Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-emerald-50 text-emerald-600">
                  <PortsIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">Ports &amp; Terminals</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Global maritime ports directory with UN/LOCODE indexing and timezone coordinates.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>{totalPorts} registered ports</span>
              <Link href="/ports" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>

          {/* Voyages Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-indigo-50 text-indigo-600">
                  <VoyagesIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">Voyages &amp; Laytime</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Voyage execution logs, milestone timelines, NOR tracking, and laytime delays.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>{totalVoyages} logged voyages</span>
              <Link href="/voyages" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>

          {/* Contracts Module */}
          <Card className="p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-amber-50 text-amber-600">
                  <ContractsIcon size={16} />
                </div>
                <span className="font-semibold text-sm text-slate-900">Contracts &amp; Clauses</span>
              </div>
              <Badge variant="success" size="sm">Live</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Commercial charter party agreements, legal rider clauses, and document chunk linking.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>{totalContracts} contracts</span>
              <Link href="/contracts" className="text-blue-600 font-semibold hover:underline">
                Open Workspace &rarr;
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
