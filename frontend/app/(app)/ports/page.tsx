"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listPorts,
  getPort,
  createPort,
  updatePort,
  deletePort,
  PortListItem,
  PortRead,
  PortCreatePayload,
  PortUpdatePayload,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  PortsIcon,
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

function formatCoordinates(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    if (lat !== null && lat !== undefined) return `${lat.toFixed(4)}°`;
    if (lon !== null && lon !== undefined) return `${lon.toFixed(4)}°`;
    return "—";
  }
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
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

interface PortFormData {
  unlocode: string;
  name: string;
  country: string;
  country_code: string;
  latitude: string;
  longitude: string;
  timezone: string;
}

const initialFormData: PortFormData = {
  unlocode: "",
  name: "",
  country: "",
  country_code: "",
  latitude: "",
  longitude: "",
  timezone: "",
};

export default function PortsPage() {
  const { backendUser } = useAuth();

  // Role permissions based strictly on backend implementation
  const role = backendUser?.role?.toLowerCase() || "viewer";
  const canMutate = role === "admin" || role === "manager" || role === "operator";
  const canDelete = role === "admin" || role === "manager";

  // Unique control IDs
  const searchInputId = useId();

  // List data state
  const [ports, setPorts] = useState<PortListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPort, setEditingPort] = useState<PortListItem | null>(null);
  const [formData, setFormData] = useState<PortFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formServerError, setFormServerError] = useState<string | null>(null);

  // Detail Modal state
  const [detailPortId, setDetailPortId] = useState<string | null>(null);
  const [detailPort, setDetailPort] = useState<PortRead | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete Dialog state
  const [portToDelete, setPortToDelete] = useState<PortListItem | null>(null);
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
  const isAnyModalOpen = isFormOpen || Boolean(detailPortId) || Boolean(portToDelete);
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
        if (portToDelete && !isDeleting) {
          setPortToDelete(null);
          setDeleteError(null);
        } else if (detailPortId && !isLoadingDetail) {
          setDetailPortId(null);
          setDetailPort(null);
        } else if (isFormOpen && !isSubmitting) {
          setIsFormOpen(false);
          setEditingPort(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [portToDelete, isDeleting, detailPortId, isLoadingDetail, isFormOpen, isSubmitting]);

  // Manual refresh function
  const refreshPorts = useCallback(
    async (targetPage = page, search = searchQuery) => {
      try {
        setLoading(true);
        setError(null);
        const res = await listPorts({
          page: targetPage,
          page_size: pageSize,
          search: search.trim() || undefined,
        });
        setPorts(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages || 1);
      } catch (err: unknown) {
        setError(
          getApiErrorMessage(
            err,
            "Unable to load port directory. Please check your network connection and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, searchQuery]
  );

  // Synchronize ports list on page or search state change
  useEffect(() => {
    let ignore = false;

    listPorts({
      page,
      page_size: pageSize,
      search: searchQuery.trim() || undefined,
    })
      .then((res) => {
        if (!ignore) {
          setPorts(res.items);
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
              "Unable to load port directory. Please check your network connection and try again."
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
  }, [page, pageSize, searchQuery]);

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
    setEditingPort(null);
    setFormData(initialFormData);
    setFormErrors({});
    setFormServerError(null);
    setIsFormOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (port: PortListItem) => {
    setEditingPort(port);
    setFormData({
      unlocode: port.unlocode,
      name: port.name,
      country: port.country,
      country_code: port.country_code || "",
      latitude: port.latitude !== null ? String(port.latitude) : "",
      longitude: port.longitude !== null ? String(port.longitude) : "",
      timezone: port.timezone || "",
    });
    setFormErrors({});
    setFormServerError(null);
    setIsFormOpen(true);
  };

  // Validate form before submission
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const cleanUnlocode = formData.unlocode.trim().toUpperCase();
    if (!cleanUnlocode) {
      errors.unlocode = "UN/LOCODE is required.";
    } else if (cleanUnlocode.length < 3 || cleanUnlocode.length > 10) {
      errors.unlocode = "UN/LOCODE must be between 3 and 10 characters (typically 5, e.g. SGSIN).";
    }

    if (!formData.name.trim()) {
      errors.name = "Port name is required.";
    } else if (formData.name.trim().length > 255) {
      errors.name = "Port name cannot exceed 255 characters.";
    }

    if (!formData.country.trim()) {
      errors.country = "Country is required.";
    } else if (formData.country.trim().length > 100) {
      errors.country = "Country cannot exceed 100 characters.";
    }

    if (formData.country_code && formData.country_code.trim().length > 5) {
      errors.country_code = "Country code cannot exceed 5 characters.";
    }

    if (formData.latitude) {
      const lat = parseFloat(formData.latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.latitude = "Latitude must be a valid number between -90 and 90.";
      }
    }

    if (formData.longitude) {
      const lon = parseFloat(formData.longitude);
      if (isNaN(lon) || lon < -180 || lon > 180) {
        errors.longitude = "Longitude must be a valid number between -180 and 180.";
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

    const payload: PortCreatePayload | PortUpdatePayload = {
      unlocode: formData.unlocode.trim().toUpperCase(),
      name: formData.name.trim(),
      country: formData.country.trim(),
      country_code: formData.country_code.trim().toUpperCase() || null,
      latitude: formData.latitude ? parseFloat(formData.latitude) : null,
      longitude: formData.longitude ? parseFloat(formData.longitude) : null,
      timezone: formData.timezone.trim() || null,
    };

    try {
      if (editingPort) {
        await updatePort(editingPort.id, payload as PortUpdatePayload);
        setFeedback({
          type: "success",
          message: `Port "${payload.name}" updated successfully.`,
        });
      } else {
        await createPort(payload as PortCreatePayload);
        setFeedback({
          type: "success",
          message: `Port "${payload.name}" registered successfully.`,
        });
      }
      setIsFormOpen(false);
      setEditingPort(null);
      refreshPorts(page, searchQuery);
    } catch (err: unknown) {
      setFormServerError(
        getApiErrorMessage(
          err,
          editingPort ? "Failed to update port record." : "Failed to register port."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Port Detail
  const handleOpenDetail = async (portId: string) => {
    setDetailPortId(portId);
    setIsLoadingDetail(true);
    try {
      const res = await getPort(portId);
      setDetailPort(res);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to load port details."),
      });
      setDetailPortId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Confirm and Execute Deletion
  const handleDeleteConfirm = async () => {
    if (!portToDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deletePort(portToDelete.id);
      setFeedback({
        type: "success",
        message: `Port "${portToDelete.name}" deleted successfully.`,
      });
      setPortToDelete(null);
      const newPage = ports.length === 1 && page > 1 ? page - 1 : page;
      setPage(newPage);
      refreshPorts(newPage, searchQuery);
    } catch (err: unknown) {
      // Backend returns 409 if voyages reference this port
      setDeleteError(
        getApiErrorMessage(
          err,
          "Failed to delete port. It may be referenced by existing operational voyage or laytime records."
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
        title="Ports Directory"
        description="Global port directory, UN/LOCODE standard indexing, terminal coordinates, and operational timezone reference."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Ports" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshPorts(page, searchQuery)}
              disabled={loading}
              title="Refresh port directory"
              aria-label="Refresh port list"
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
                <span>Register Port</span>
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
            onClick={() => refreshPorts(page, searchQuery)}
            className="gap-1.5 text-xs"
          >
            <RefreshIcon size={13} />
            <span>Retry Connection</span>
          </Button>
        </Card>
      )}

      {/* Search Toolbar */}
      <Card className="p-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-3">
          <div className="relative flex-1">
            <label htmlFor={searchInputId} className="sr-only">
              Search ports directory
            </label>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <SearchIcon size={15} />
            </div>
            <input
              id={searchInputId}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by port name, UN/LOCODE (e.g. NLRTM), or country..."
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

          <Button type="submit" variant="secondary" size="sm" className="gap-1.5 text-xs shrink-0">
            <span>Search</span>
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

        {/* Empty State: No ports in directory */}
        {!loading && !error && total === 0 && !searchQuery && (
          <EmptyState
            icon={<PortsIcon size={24} />}
            badgeText="Port Infrastructure"
            title="No Ports Registered Yet"
            description="Your organization does not have any ports registered in the directory. Add international ports with UN/LOCODE identifiers to link voyage origins, destinations, and laytime events."
            action={
              canMutate ? (
                <Button variant="primary" size="sm" onClick={handleOpenCreate} className="gap-1.5 text-xs">
                  <PlusIcon size={14} />
                  <span>Register First Port</span>
                </Button>
              ) : undefined
            }
          />
        )}

        {/* Empty State: Filter / search yielded no results */}
        {!loading && !error && total === 0 && searchQuery && (
          <EmptyState
            icon={<SearchIcon size={24} />}
            badgeText="Search Results"
            title="No Ports Match Your Search"
            description={`No ports found matching "${searchQuery}". Try searching with a different port name, country, or UN/LOCODE code.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearSearch}
                className="gap-1.5 text-xs"
              >
                <span>Reset Search</span>
              </Button>
            }
          />
        )}

        {/* Port Records (Desktop Table & Mobile Stacked Cards) */}
        {!loading && !error && ports.length > 0 && (
          <Card className="overflow-hidden shadow-xs">
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Ports directory table">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="py-3 pl-5 pr-3">Port Facility</th>
                    <th scope="col" className="px-3 py-3">UN/LOCODE</th>
                    <th scope="col" className="px-3 py-3">Country / State</th>
                    <th scope="col" className="px-3 py-3">Coordinates</th>
                    <th scope="col" className="px-3 py-3">Timezone</th>
                    <th scope="col" className="py-3 pl-3 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ports.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pl-5 pr-3 font-semibold text-slate-900 max-w-xs truncate">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(p.id)}
                          className="text-left font-semibold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer"
                          title={`View details for ${p.name}`}
                        >
                          {p.name}
                        </button>
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <Badge variant="outline" size="sm" className="font-mono text-xs font-semibold">
                          {p.unlocode}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        <span>{p.country}</span>
                        {p.country_code && (
                          <span className="ml-1 text-slate-400 font-mono text-[11px]">({p.country_code})</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatCoordinates(p.latitude, p.longitude)}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {p.timezone || "—"}
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetail(p.id)}
                            title="View port details"
                            aria-label={`View details of ${p.name}`}
                            className="p-1.5 text-slate-500 hover:text-blue-600"
                          >
                            <EyeIcon size={15} />
                          </Button>

                          {canMutate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEdit(p)}
                              title="Edit port particulars"
                              aria-label={`Edit ${p.name}`}
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
                                setPortToDelete(p);
                                setDeleteError(null);
                              }}
                              title="Delete port"
                              aria-label={`Delete ${p.name}`}
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
              {ports.map((p) => (
                <div key={p.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(p.id)}
                        className="text-left font-semibold text-slate-900 hover:text-blue-600 text-sm"
                      >
                        {p.name}
                      </button>
                      <p className="text-xs text-slate-500">
                        {p.country} {p.country_code ? `(${p.country_code})` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" size="sm" className="font-mono text-xs font-semibold">
                      {p.unlocode}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600 pt-1 border-t border-slate-50">
                    <div>
                      <span className="text-slate-400">Position:</span>{" "}
                      <span className="font-mono text-[11px]">{formatCoordinates(p.latitude, p.longitude)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Timezone:</span>{" "}
                      <span className="font-mono text-[11px]">{p.timezone || "—"}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDetail(p.id)}
                      className="gap-1 text-xs"
                    >
                      <EyeIcon size={13} />
                      <span>Details</span>
                    </Button>

                    {canMutate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(p)}
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
                          setPortToDelete(p);
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
                  <span className="font-semibold">{totalPages}</span> ({total} ports total)
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
          MODAL: Register or Edit Port
      ────────────────────────────────────────────────────────────────────────── */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="port-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) {
              setIsFormOpen(false);
              setEditingPort(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                  <PortsIcon size={18} />
                </div>
                <div>
                  <h3 id="port-form-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    {editingPort ? `Edit Port: ${editingPort.name}` : "Register Port Facility"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingPort
                      ? "Update geographical coordinates and operational details"
                      : "Add a maritime port or terminal facility to the global directory"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmitting) {
                    setIsFormOpen(false);
                    setEditingPort(null);
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

              {/* UN/LOCODE and Port Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_unlocode" className="block text-xs font-semibold text-slate-700 mb-1">
                    UN/LOCODE <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_unlocode"
                    type="text"
                    required
                    value={formData.unlocode}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, unlocode: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. NLRTM"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.unlocode && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.unlocode}</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">5-character identifier</p>
                </div>

                <div>
                  <label htmlFor="form_port_name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Port Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_port_name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Port of Rotterdam"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {formErrors.name && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.name}</p>
                  )}
                </div>
              </div>

              {/* Country and Country Code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_country" className="block text-xs font-semibold text-slate-700 mb-1">
                    Country / State <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="form_country"
                    type="text"
                    required
                    value={formData.country}
                    onChange={(e) => setFormData((prev) => ({ ...prev, country: e.target.value }))}
                    placeholder="e.g. Netherlands"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {formErrors.country && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.country}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="form_country_code" className="block text-xs font-semibold text-slate-700 mb-1">
                    ISO Country Code
                  </label>
                  <input
                    id="form_country_code"
                    type="text"
                    maxLength={5}
                    value={formData.country_code}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, country_code: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. NL"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.country_code && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.country_code}</p>
                  )}
                </div>
              </div>

              {/* Geographic Coordinates: Latitude and Longitude */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="form_latitude" className="block text-xs font-semibold text-slate-700 mb-1">
                    Latitude (-90 to 90)
                  </label>
                  <input
                    id="form_latitude"
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={formData.latitude}
                    onChange={(e) => setFormData((prev) => ({ ...prev, latitude: e.target.value }))}
                    placeholder="e.g. 51.9054"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.latitude && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.latitude}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="form_longitude" className="block text-xs font-semibold text-slate-700 mb-1">
                    Longitude (-180 to 180)
                  </label>
                  <input
                    id="form_longitude"
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={formData.longitude}
                    onChange={(e) => setFormData((prev) => ({ ...prev, longitude: e.target.value }))}
                    placeholder="e.g. 4.4666"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {formErrors.longitude && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.longitude}</p>
                  )}
                </div>
              </div>

              {/* Operational Timezone */}
              <div>
                <label htmlFor="form_timezone" className="block text-xs font-semibold text-slate-700 mb-1">
                  IANA Operational Timezone
                </label>
                <input
                  id="form_timezone"
                  type="text"
                  value={formData.timezone}
                  onChange={(e) => setFormData((prev) => ({ ...prev, timezone: e.target.value }))}
                  placeholder="e.g. Europe/Amsterdam or Asia/Singapore"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingPort(null);
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
                    <span>{editingPort ? "Update Port" : "Register Port"}</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Port Details View
      ────────────────────────────────────────────────────────────────────────── */}
      {detailPortId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="port-detail-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLoadingDetail) {
              setDetailPortId(null);
              setDetailPort(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                  <PortsIcon size={18} />
                </div>
                <div>
                  <h3 id="port-detail-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    {detailPort?.name || "Port Details"}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    UN/LOCODE: {detailPort?.unlocode || "..."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailPortId(null);
                  setDetailPort(null);
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
                  <p className="text-xs">Loading port particulars...</p>
                </div>
              )}

              {!isLoadingDetail && detailPort && (
                <div className="space-y-4">
                  {/* UN/LOCODE Identifier Header */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-xs font-semibold text-slate-600">UN Standard Code</span>
                    <Badge variant="outline" size="sm" className="font-mono text-xs font-semibold">
                      {detailPort.unlocode}
                    </Badge>
                  </div>

                  {/* Key Specifications Grid */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Country / Jurisdiction</span>
                      <span className="font-semibold text-slate-800">
                        {detailPort.country} {detailPort.country_code ? `(${detailPort.country_code})` : ""}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Operational Timezone</span>
                      <span className="font-mono font-semibold text-slate-800">{detailPort.timezone || "—"}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 col-span-2">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Geographical Coordinates</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {formatCoordinates(detailPort.latitude, detailPort.longitude)}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Created In Directory</span>
                      <span className="text-slate-800">{formatDate(detailPort.created_at)}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Last Record Update</span>
                      <span className="text-slate-800">{formatDate(detailPort.updated_at)}</span>
                    </div>
                  </div>

                  {/* Informational Note */}
                  <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-800">
                    <p className="font-semibold mb-0.5">Voyage Rotation Node</p>
                    <p className="text-[11px] text-emerald-700 leading-relaxed">
                      This port is available as an origin, destination, or milestone event node for all maritime voyages
                      in your organization.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 sm:p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
              <Link
                href="/voyages"
                className="text-emerald-700 hover:text-emerald-800 font-medium inline-flex items-center gap-1"
              >
                <span>View Voyages Rotations</span>
                <ChevronRightIcon size={12} />
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailPortId(null);
                  setDetailPort(null);
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
          MODAL: Delete Port Confirmation (Manager / Admin Only)
      ────────────────────────────────────────────────────────────────────────── */}
      {portToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-port-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setPortToDelete(null);
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
                <h3 id="delete-port-dialog-title" className="text-base font-semibold text-slate-900">
                  Delete Port Record
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-slate-800">{portToDelete.name}</span> (UN/LOCODE:{" "}
                  <span className="font-mono text-slate-800">{portToDelete.unlocode}</span>)? This action is permanent.
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
                  setPortToDelete(null);
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
