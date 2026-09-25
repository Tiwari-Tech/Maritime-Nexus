"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listVessels,
  getVessel,
  createVessel,
  updateVessel,
  deleteVessel,
  VesselListItem,
  VesselRead,
  VesselCreatePayload,
  VesselUpdatePayload,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  VesselsIcon,
  PlusIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  EyeIcon,
  RefreshIcon,
  SpinnerIcon,
  CloseIcon,
  ChevronRightIcon,
  CheckIcon,
} from "@/components/icons";

const VESSEL_STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "in_drydock", label: "In Drydock" },
  { value: "laid_up", label: "Laid Up" },
  { value: "decommissioned", label: "Decommissioned" },
];

const COMMON_VESSEL_TYPES = [
  "Bulk Carrier",
  "Container Ship",
  "Oil Tanker",
  "Chemical Tanker",
  "LNG Carrier",
  "LPG Carrier",
  "General Cargo",
  "Ro-Ro Cargo",
  "Offshore Supply",
  "Tug / Barge",
];

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(num);
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

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    active: "Active",
    in_drydock: "In Drydock",
    laid_up: "Laid Up",
    decommissioned: "Decommissioned",
  };
  return map[status.toLowerCase()] || status;
}

function VesselStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const label = formatStatus(status);
  if (s === "active") {
    return <Badge variant="success" size="sm">{label}</Badge>;
  }
  if (s === "in_drydock") {
    return <Badge variant="warning" size="sm">{label}</Badge>;
  }
  if (s === "laid_up") {
    return <Badge variant="secondary" size="sm">{label}</Badge>;
  }
  if (s === "decommissioned") {
    return <Badge variant="danger" size="sm">{label}</Badge>;
  }
  return <Badge variant="outline" size="sm">{label}</Badge>;
}

interface VesselFormData {
  imo_number: string;
  name: string;
  vessel_type: string;
  flag: string;
  call_sign: string;
  mmsi: string;
  deadweight_tonnage: string;
  gross_tonnage: string;
  year_built: string;
  status: string;
}

const initialFormData: VesselFormData = {
  imo_number: "",
  name: "",
  vessel_type: "Bulk Carrier",
  flag: "",
  call_sign: "",
  mmsi: "",
  deadweight_tonnage: "",
  gross_tonnage: "",
  year_built: "",
  status: "active",
};

export default function VesselsPage() {
  const { backendUser } = useAuth();

  // Role permissions based strictly on backend implementation
  const role = backendUser?.role?.toLowerCase() || "viewer";
  const canMutate = role === "admin" || role === "manager" || role === "operator";
  const canDelete = role === "admin" || role === "manager";

  // Unique IDs for form controls
  const searchInputId = useId();
  const statusFilterId = useId();
  const vesselTypeFilterId = useId();

  // List data state
  const [vessels, setVessels] = useState<VesselListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVessel, setEditingVessel] = useState<VesselListItem | null>(null);
  const [formData, setFormData] = useState<VesselFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formServerError, setFormServerError] = useState<string | null>(null);

  // Detail Modal state
  const [detailVesselId, setDetailVesselId] = useState<string | null>(null);
  const [detailVessel, setDetailVessel] = useState<VesselRead | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete Dialog state
  const [vesselToDelete, setVesselToDelete] = useState<VesselListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Notification feedback
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Auto-dismiss feedback message after 5 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Lock body scroll when any modal is open
  const isAnyModalOpen = isFormOpen || Boolean(detailVesselId) || Boolean(vesselToDelete);
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isAnyModalOpen]);

  // Handle Escape key to dismiss dialogs
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (vesselToDelete && !isDeleting) {
          setVesselToDelete(null);
          setDeleteError(null);
        } else if (detailVesselId && !isLoadingDetail) {
          setDetailVesselId(null);
          setDetailVessel(null);
        } else if (isFormOpen && !isSubmitting) {
          setIsFormOpen(false);
          setEditingVessel(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [vesselToDelete, isDeleting, detailVesselId, isLoadingDetail, isFormOpen, isSubmitting]);

  // Manual refresh function
  const refreshVessels = useCallback(
    async (
      targetPage = page,
      search = searchQuery,
      status = statusFilter,
      vesselType = typeFilter
    ) => {
      try {
        setLoading(true);
        setError(null);
        const res = await listVessels({
          page: targetPage,
          page_size: pageSize,
          search: search.trim() || undefined,
          status: status || undefined,
          vessel_type: vesselType || undefined,
        });
        setVessels(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages || 1);
      } catch (err: unknown) {
        setError(
          getApiErrorMessage(
            err,
            "Unable to load fleet registry. Please check your network connection and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, searchQuery, statusFilter, typeFilter]
  );

  // Synchronize vessel list on page or filter state change
  useEffect(() => {
    let ignore = false;

    listVessels({
      page,
      page_size: pageSize,
      search: searchQuery.trim() || undefined,
      status: statusFilter || undefined,
      vessel_type: typeFilter || undefined,
    })
      .then((res) => {
        if (!ignore) {
          setVessels(res.items);
          setTotal(res.total);
          setTotalPages(res.total_pages || 1);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              err,
              "Unable to load fleet registry. Please check your network connection and try again."
            )
          );
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
  }, [page, pageSize, searchQuery, statusFilter, typeFilter]);

  // Handle search submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearchQuery(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingVessel(null);
    setFormData(initialFormData);
    setFormErrors({});
    setFormServerError(null);
    setIsFormOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (vessel: VesselListItem) => {
    setEditingVessel(vessel);
    setFormData({
      imo_number: vessel.imo_number,
      name: vessel.name,
      vessel_type: vessel.vessel_type,
      flag: vessel.flag || "",
      call_sign: vessel.call_sign || "",
      mmsi: vessel.mmsi || "",
      deadweight_tonnage: vessel.deadweight_tonnage !== null ? String(vessel.deadweight_tonnage) : "",
      gross_tonnage: vessel.gross_tonnage !== null ? String(vessel.gross_tonnage) : "",
      year_built: vessel.year_built !== null ? String(vessel.year_built) : "",
      status: vessel.status || "active",
    });
    setFormErrors({});
    setFormServerError(null);
    setIsFormOpen(true);
  };

  // Validate form before submission
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const cleanImo = formData.imo_number.trim().toUpperCase();
    if (!cleanImo) {
      errors.imo_number = "IMO number is required.";
    } else if (cleanImo.length < 3 || cleanImo.length > 10) {
      errors.imo_number = "IMO number must be between 3 and 10 characters.";
    }

    if (!formData.name.trim()) {
      errors.name = "Vessel name is required.";
    } else if (formData.name.trim().length > 255) {
      errors.name = "Vessel name cannot exceed 255 characters.";
    }

    if (!formData.vessel_type.trim()) {
      errors.vessel_type = "Vessel type is required.";
    }

    if (formData.deadweight_tonnage) {
      const dwt = parseFloat(formData.deadweight_tonnage);
      if (isNaN(dwt) || dwt < 0) {
        errors.deadweight_tonnage = "Deadweight tonnage must be a non-negative number.";
      }
    }

    if (formData.gross_tonnage) {
      const gt = parseFloat(formData.gross_tonnage);
      if (isNaN(gt) || gt < 0) {
        errors.gross_tonnage = "Gross tonnage must be a non-negative number.";
      }
    }

    if (formData.year_built) {
      const yr = parseInt(formData.year_built, 10);
      if (isNaN(yr) || yr < 1800 || yr > 2100) {
        errors.year_built = "Year built must be between 1800 and 2100.";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Create or Edit form
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || isSubmitting) return;

    setIsSubmitting(true);
    setFormServerError(null);

    const payload: VesselCreatePayload | VesselUpdatePayload = {
      imo_number: formData.imo_number.trim().toUpperCase(),
      name: formData.name.trim(),
      vessel_type: formData.vessel_type.trim(),
      flag: formData.flag.trim() || null,
      call_sign: formData.call_sign.trim().toUpperCase() || null,
      mmsi: formData.mmsi.trim() || null,
      deadweight_tonnage: formData.deadweight_tonnage ? parseFloat(formData.deadweight_tonnage) : null,
      gross_tonnage: formData.gross_tonnage ? parseFloat(formData.gross_tonnage) : null,
      year_built: formData.year_built ? parseInt(formData.year_built, 10) : null,
      status: formData.status.trim().toLowerCase(),
    };

    try {
      if (editingVessel) {
        await updateVessel(editingVessel.id, payload as VesselUpdatePayload);
        setFeedback({
          type: "success",
          message: `Vessel "${payload.name}" updated successfully.`,
        });
      } else {
        await createVessel(payload as VesselCreatePayload);
        setFeedback({
          type: "success",
          message: `Vessel "${payload.name}" registered successfully.`,
        });
      }
      setIsFormOpen(false);
      setEditingVessel(null);
      refreshVessels(page, searchQuery, statusFilter, typeFilter);
    } catch (err: unknown) {
      setFormServerError(
        getApiErrorMessage(
          err,
          editingVessel ? "Failed to update vessel." : "Failed to register vessel."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Vessel Detail
  const handleOpenDetail = async (vesselId: string) => {
    setDetailVesselId(vesselId);
    setIsLoadingDetail(true);
    try {
      const res = await getVessel(vesselId);
      setDetailVessel(res);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to load vessel details."),
      });
      setDetailVesselId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Confirm and Execute Deletion
  const handleDeleteConfirm = async () => {
    if (!vesselToDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteVessel(vesselToDelete.id);
      setFeedback({
        type: "success",
        message: `Vessel "${vesselToDelete.name}" deleted successfully.`,
      });
      setVesselToDelete(null);
      // If deleting last item on current page, go to previous page
      const newPage = vessels.length === 1 && page > 1 ? page - 1 : page;
      setPage(newPage);
      refreshVessels(newPage, searchQuery, statusFilter, typeFilter);
    } catch (err: unknown) {
      // Backend returns 409 if voyages reference this vessel
      setDeleteError(
        getApiErrorMessage(
          err,
          "Failed to delete vessel. It may be referenced by existing operational voyage records."
        )
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Page Header */}
      <PageHeader
        title="Fleet Registry"
        description="Comprehensive technical fleet registry, IMO documentation, and operational vessel tracking."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Vessels" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshVessels(page, searchQuery, statusFilter, typeFilter)}
              disabled={loading}
              title="Refresh fleet registry"
              aria-label="Refresh vessel list"
              className="gap-1.5 text-xs"
            >
              <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {canMutate && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreate}
                className="gap-1.5 text-xs shadow-xs"
              >
                <PlusIcon size={14} />
                <span>Register Vessel</span>
              </Button>
            )}
          </div>
        }
      />

      {/* Global Feedback Banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between shadow-xs transition-all ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckIcon size={16} className="text-emerald-600 shrink-0" />
            ) : (
              <CloseIcon size={16} className="text-red-600 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
            aria-label="Dismiss notification"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* Global Load Error State */}
      {error && !loading && (
        <Card className="p-6 text-center border-red-200 bg-red-50/60 shadow-xs">
          <p className="text-sm font-medium text-red-800 mb-3">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshVessels(page, searchQuery, statusFilter, typeFilter)}
            className="gap-1.5 text-xs"
          >
            <RefreshIcon size={13} />
            <span>Retry Connection</span>
          </Button>
        </Card>
      )}

      {/* Search and Filters Toolbar */}
      <Card className="p-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Text search */}
          <div className="relative flex-1">
            <label htmlFor={searchInputId} className="sr-only">
              Search fleet registry
            </label>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <SearchIcon size={15} />
            </div>
            <input
              id={searchInputId}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by vessel name, IMO, or call sign..."
              className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white placeholder-slate-400 transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                aria-label="Clear search input"
              >
                <CloseIcon size={13} />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="w-full sm:w-44">
            <label htmlFor={statusFilterId} className="sr-only">
              Filter by status
            </label>
            <select
              id={statusFilterId}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-700"
            >
              {VESSEL_STATUSES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          {/* Vessel Type Filter */}
          <div className="w-full sm:w-44">
            <label htmlFor={vesselTypeFilterId} className="sr-only">
              Filter by classification
            </label>
            <select
              id={vesselTypeFilterId}
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-700"
            >
              <option value="">All Vessel Types</option>
              {COMMON_VESSEL_TYPES.map((vt) => (
                <option key={vt} value={vt}>
                  {vt}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" variant="secondary" size="sm" className="gap-1.5 text-xs shrink-0">
            <span>Filter</span>
          </Button>
        </form>
      </Card>

      {/* Main Content Area */}
      <div className="space-y-4">
        {/* Loading Skeleton */}
        {loading && (
          <Card className="divide-y divide-slate-100 overflow-hidden shadow-xs">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center justify-between animate-pulse">
                <div className="space-y-2">
                  <div className="h-4 w-48 sm:w-64 bg-slate-200 rounded" />
                  <div className="h-3 w-32 bg-slate-100 rounded" />
                </div>
                <div className="h-6 w-20 bg-slate-200 rounded-full" />
              </div>
            ))}
          </Card>
        )}

        {/* Empty State: No vessels registered yet */}
        {!loading && !error && total === 0 && !searchQuery && !statusFilter && !typeFilter && (
          <EmptyState
            icon={<VesselsIcon size={24} />}
            badgeText="Fleet Management"
            title="No Active Vessels in Fleet Registry"
            description="Your organization does not have any vessels registered. Add your fleet vessels to associate voyages, charter party contracts, and technical documents."
            action={
              canMutate ? (
                <Button variant="primary" size="sm" onClick={handleOpenCreate} className="gap-1.5 text-xs">
                  <PlusIcon size={14} />
                  <span>Register First Vessel</span>
                </Button>
              ) : undefined
            }
          />
        )}

        {/* Empty State: Filter yielded no results */}
        {!loading && !error && total === 0 && (searchQuery || statusFilter || typeFilter) && (
          <EmptyState
            icon={<SearchIcon size={24} />}
            badgeText="Search Results"
            title="No Vessels Match Your Filters"
            description="No vessels in your fleet registry matched your search query or filter criteria. Try clearing or relaxing the filters."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleClearSearch();
                  setStatusFilter("");
                  setTypeFilter("");
                }}
                className="gap-1.5 text-xs"
              >
                <span>Reset All Filters</span>
              </Button>
            }
          />
        )}

        {/* Vessel Records (Desktop Table & Mobile Stacked Cards) */}
        {!loading && !error && vessels.length > 0 && (
          <Card className="overflow-hidden shadow-xs">
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Fleet registry table">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="py-3 pl-5 pr-3">Vessel Name</th>
                    <th scope="col" className="px-3 py-3">IMO Number</th>
                    <th scope="col" className="px-3 py-3">Classification</th>
                    <th scope="col" className="px-3 py-3">Flag / Registry</th>
                    <th scope="col" className="px-3 py-3 text-right">Deadweight</th>
                    <th scope="col" className="px-3 py-3 text-center">Year</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="py-3 pl-3 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vessels.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pl-5 pr-3 font-semibold text-slate-900 max-w-xs truncate">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(v.id)}
                          className="text-left font-semibold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer"
                          title={`View details for ${v.name}`}
                        >
                          {v.name}
                        </button>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {v.imo_number}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {v.vessel_type}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {v.flag || "—"}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-700 text-right font-mono whitespace-nowrap">
                        {v.deadweight_tonnage !== null ? `${formatNumber(v.deadweight_tonnage)} MT` : "—"}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 text-center font-mono whitespace-nowrap">
                        {v.year_built || "—"}
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <VesselStatusBadge status={v.status} />
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetail(v.id)}
                            title="View vessel details"
                            aria-label={`View details of ${v.name}`}
                            className="p-1.5 text-slate-500 hover:text-blue-600"
                          >
                            <EyeIcon size={15} />
                          </Button>

                          {canMutate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEdit(v)}
                              title="Edit vessel particulars"
                              aria-label={`Edit ${v.name}`}
                              className="p-1.5 text-slate-500 hover:text-slate-800"
                            >
                              <EditIcon size={14} />
                            </Button>
                          )}

                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setVesselToDelete(v);
                                setDeleteError(null);
                              }}
                              title="Delete vessel"
                              aria-label={`Delete ${v.name}`}
                              className="p-1.5 text-slate-400 hover:text-red-600"
                            >
                              <TrashIcon size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card View */}
            <div className="md:hidden divide-y divide-slate-100">
              {vessels.map((v) => (
                <div key={v.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(v.id)}
                        className="text-left font-semibold text-slate-900 hover:text-blue-600 text-sm"
                      >
                        {v.name}
                      </button>
                      <p className="font-mono text-xs text-slate-500">{v.imo_number}</p>
                    </div>
                    <VesselStatusBadge status={v.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600 pt-1 border-t border-slate-50">
                    <div>
                      <span className="text-slate-400">Type:</span> {v.vessel_type}
                    </div>
                    <div>
                      <span className="text-slate-400">Flag:</span> {v.flag || "—"}
                    </div>
                    <div>
                      <span className="text-slate-400">DWT:</span>{" "}
                      {v.deadweight_tonnage !== null ? `${formatNumber(v.deadweight_tonnage)} MT` : "—"}
                    </div>
                    <div>
                      <span className="text-slate-400">Built:</span> {v.year_built || "—"}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDetail(v.id)}
                      className="gap-1 text-xs"
                    >
                      <EyeIcon size={13} />
                      <span>Details</span>
                    </Button>

                    {canMutate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(v)}
                        className="gap-1 text-xs"
                      >
                        <EditIcon size={13} />
                        <span>Edit</span>
                      </Button>
                    )}

                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setVesselToDelete(v);
                          setDeleteError(null);
                        }}
                        className="text-xs text-red-600 hover:bg-red-50"
                      >
                        <TrashIcon size={13} />
                        <span>Delete</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-3.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <div>
                  Showing page <span className="font-semibold">{page}</span> of{" "}
                  <span className="font-semibold">{totalPages}</span> ({total} vessels total)
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="text-xs px-2.5 py-1"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="text-xs px-2.5 py-1"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Register or Edit Vessel
      ────────────────────────────────────────────────────────────────────────── */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vessel-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) {
              setIsFormOpen(false);
              setEditingVessel(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <VesselsIcon size={18} />
                </div>
                <div>
                  <h3 id="vessel-form-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    {editingVessel ? `Edit Vessel: ${editingVessel.name}` : "Register Fleet Vessel"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingVessel
                      ? "Update technical particulars and operational classification"
                      : "Add a new commercial vessel to your organization fleet"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmitting) {
                    setIsFormOpen(false);
                    setEditingVessel(null);
                  }
                }}
                disabled={isSubmitting}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleFormSubmit} className="p-4 sm:p-5 space-y-4">
              {formServerError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {formServerError}
                </div>
              )}

              {/* IMO Number and Vessel Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_imo_number" className="block text-xs font-semibold text-slate-700 mb-1">
                    IMO Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_imo_number"
                    type="text"
                    required
                    value={formData.imo_number}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, imo_number: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. IMO9123456"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.imo_number && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.imo_number}</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">Unique 7-digit identifier</p>
                </div>

                <div>
                  <label htmlFor="form_name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Vessel Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Nordic Enterprise"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {formErrors.name && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.name}</p>
                  )}
                </div>
              </div>

              {/* Classification Type and Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_vessel_type" className="block text-xs font-semibold text-slate-700 mb-1">
                    Vessel Type <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_vessel_type"
                    type="text"
                    required
                    list="vessel-types-datalist"
                    value={formData.vessel_type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, vessel_type: e.target.value }))}
                    placeholder="e.g. Bulk Carrier"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <datalist id="vessel-types-datalist">
                    {COMMON_VESSEL_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  {formErrors.vessel_type && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.vessel_type}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="form_status" className="block text-xs font-semibold text-slate-700 mb-1">
                    Operating Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="form_status"
                    value={formData.status}
                    onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="in_drydock">In Drydock</option>
                    <option value="laid_up">Laid Up</option>
                    <option value="decommissioned">Decommissioned</option>
                  </select>
                </div>
              </div>

              {/* Flag State and Call Sign */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_flag" className="block text-xs font-semibold text-slate-700 mb-1">
                    Flag Administration
                  </label>
                  <input
                    id="form_flag"
                    type="text"
                    value={formData.flag}
                    onChange={(e) => setFormData((prev) => ({ ...prev, flag: e.target.value }))}
                    placeholder="e.g. Liberia, Panama, Marshall Islands"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="form_call_sign" className="block text-xs font-semibold text-slate-700 mb-1">
                    Radio Call Sign
                  </label>
                  <input
                    id="form_call_sign"
                    type="text"
                    value={formData.call_sign}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, call_sign: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. ELAB4"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* MMSI and Year Built */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_mmsi" className="block text-xs font-semibold text-slate-700 mb-1">
                    MMSI (AIS Identifier)
                  </label>
                  <input
                    id="form_mmsi"
                    type="text"
                    value={formData.mmsi}
                    onChange={(e) => setFormData((prev) => ({ ...prev, mmsi: e.target.value }))}
                    placeholder="e.g. 636012345"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="form_year_built" className="block text-xs font-semibold text-slate-700 mb-1">
                    Year Delivered / Built
                  </label>
                  <input
                    id="form_year_built"
                    type="number"
                    min="1800"
                    max="2100"
                    value={formData.year_built}
                    onChange={(e) => setFormData((prev) => ({ ...prev, year_built: e.target.value }))}
                    placeholder="e.g. 2018"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.year_built && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.year_built}</p>
                  )}
                </div>
              </div>

              {/* Tonnages: Deadweight and Gross Tonnage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_dwt" className="block text-xs font-semibold text-slate-700 mb-1">
                    Deadweight Tonnage (DWT, Metric Tonnes)
                  </label>
                  <input
                    id="form_dwt"
                    type="number"
                    step="any"
                    min="0"
                    value={formData.deadweight_tonnage}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, deadweight_tonnage: e.target.value }))
                    }
                    placeholder="e.g. 82500"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.deadweight_tonnage && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.deadweight_tonnage}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="form_gross_tonnage" className="block text-xs font-semibold text-slate-700 mb-1">
                    Gross Tonnage (GT)
                  </label>
                  <input
                    id="form_gross_tonnage"
                    type="number"
                    step="any"
                    min="0"
                    value={formData.gross_tonnage}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, gross_tonnage: e.target.value }))
                    }
                    placeholder="e.g. 43000"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.gross_tonnage && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.gross_tonnage}</p>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingVessel(null);
                  }}
                  disabled={isSubmitting}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting}
                  className="gap-1.5 text-xs min-w-28 justify-center shadow-xs"
                >
                  {isSubmitting ? (
                    <>
                      <SpinnerIcon size={12} />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingVessel ? "Update Vessel" : "Register Vessel"}</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Vessel Details View
      ────────────────────────────────────────────────────────────────────────── */}
      {detailVesselId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vessel-detail-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLoadingDetail) {
              setDetailVesselId(null);
              setDetailVessel(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <VesselsIcon size={18} />
                </div>
                <div>
                  <h3 id="vessel-detail-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    {detailVessel?.name || "Vessel Details"}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    IMO: {detailVessel?.imo_number || "..."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailVesselId(null);
                  setDetailVessel(null);
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close details"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-4">
              {isLoadingDetail && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <SpinnerIcon size={24} />
                  <p className="text-xs">Loading vessel particulars...</p>
                </div>
              )}

              {!isLoadingDetail && detailVessel && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-xs font-semibold text-slate-600">Operating Status</span>
                    <VesselStatusBadge status={detailVessel.status} />
                  </div>

                  {/* Key Specifications Grid */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Classification Type</span>
                      <span className="font-semibold text-slate-800">{detailVessel.vessel_type}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Flag Administration</span>
                      <span className="font-semibold text-slate-800">{detailVessel.flag || "—"}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Deadweight (DWT)</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {detailVessel.deadweight_tonnage !== null
                          ? `${formatNumber(detailVessel.deadweight_tonnage)} MT`
                          : "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Gross Tonnage (GT)</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {detailVessel.gross_tonnage !== null
                          ? `${formatNumber(detailVessel.gross_tonnage)} GT`
                          : "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Radio Call Sign</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {detailVessel.call_sign || "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">MMSI (AIS)</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {detailVessel.mmsi || "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Year Built</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {detailVessel.year_built || "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Registered In System</span>
                      <span className="text-slate-800">{formatDate(detailVessel.created_at)}</span>
                    </div>
                  </div>

                  {/* Relational Linkage Prompt */}
                  <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-100 text-xs text-blue-800">
                    <p className="font-semibold mb-0.5">Operational Linkage</p>
                    <p className="text-[11px] text-blue-700 leading-relaxed">
                      You can attach charter parties, bills of lading, and notice of readiness documents to this vessel
                      directly from the Documents repository.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 sm:p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
              <Link
                href="/documents"
                className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
              >
                <span>View Linked Documents</span>
                <ChevronRightIcon size={12} />
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailVesselId(null);
                  setDetailVessel(null);
                }}
                className="text-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Delete Vessel Confirmation (Manager / Admin Only)
      ────────────────────────────────────────────────────────────────────────── */}
      {vesselToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-vessel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setVesselToDelete(null);
              setDeleteError(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 sm:p-6 space-y-4 animate-in fade-in-0 zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-50 text-red-600 shrink-0">
                <TrashIcon size={20} />
              </div>
              <div className="space-y-1">
                <h3 id="delete-vessel-dialog-title" className="text-base font-semibold text-slate-900">
                  Delete Vessel Record
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-slate-800">{vesselToDelete.name}</span> (IMO:{" "}
                  <span className="font-mono text-slate-800">{vesselToDelete.imo_number}</span>)? This action is permanent.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 leading-relaxed">
                {deleteError}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setVesselToDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="gap-1.5 text-xs min-w-28 justify-center shadow-xs"
              >
                {isDeleting ? (
                  <>
                    <SpinnerIcon size={12} />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Confirm Delete</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
