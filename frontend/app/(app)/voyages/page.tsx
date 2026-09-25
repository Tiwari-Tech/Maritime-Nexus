"use client";

import React, { useState, useEffect, useCallback, useId, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listVoyages,
  getVoyage,
  createVoyage,
  updateVoyage,
  deleteVoyage,
  createVoyageEvent,
  listVessels,
  listPorts,
  VoyageListItem,
  VoyageRead,
  VoyageEventRead,
  VoyageCreatePayload,
  VoyageUpdatePayload,
  VoyageEventCreatePayload,
  VesselListItem,
  PortListItem,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  VoyagesIcon,
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

const VOYAGE_STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "planned", label: "Planned" },
  { value: "in_transit", label: "In Transit" },
  { value: "berthed", label: "Berthed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const COMMON_EVENT_TYPES = [
  { value: "NOTICE_OF_READINESS", label: "Notice of Readiness (NOR)" },
  { value: "PILOT_ON_BOARD", label: "Pilot on Board" },
  { value: "BERTHING", label: "Berthing" },
  { value: "COMMENCED_LOADING", label: "Commenced Loading" },
  { value: "COMPLETED_LOADING", label: "Completed Loading" },
  { value: "COMMENCED_DISCHARGE", label: "Commenced Discharge" },
  { value: "COMPLETED_DISCHARGE", label: "Completed Discharge" },
  { value: "DEPARTURE", label: "Departure" },
  { value: "BUNKERING", label: "Bunkering" },
  { value: "ANCHORAGE", label: "Anchorage" },
  { value: "CUSTOMS_CLEARANCE", label: "Customs Clearance" },
  { value: "DELAY", label: "Operational Delay" },
];

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function toDateTimeLocal(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(num);
}

function formatEventType(type: string): string {
  const match = COMMON_EVENT_TYPES.find((e) => e.value === type);
  if (match) return match.label;
  return type.replace(/_/g, " ");
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
  if (s === "planned") {
    return <Badge variant="secondary" size="sm">Planned</Badge>;
  }
  return <Badge variant="outline" size="sm">{status}</Badge>;
}

interface VoyageFormData {
  vessel_id: string;
  voyage_number: string;
  origin_port_id: string;
  destination_port_id: string;
  departure_date: string;
  arrival_date: string;
  status: string;
  cargo_type: string;
  cargo_quantity: string;
}

const initialVoyageFormData: VoyageFormData = {
  vessel_id: "",
  voyage_number: "",
  origin_port_id: "",
  destination_port_id: "",
  departure_date: "",
  arrival_date: "",
  status: "planned",
  cargo_type: "",
  cargo_quantity: "",
};

interface EventFormData {
  event_type: string;
  timestamp: string;
  end_timestamp: string;
  port_id: string;
  description: string;
  is_delay: boolean;
  delay_reason: string;
}

const initialEventFormData: EventFormData = {
  event_type: "NOTICE_OF_READINESS",
  timestamp: "",
  end_timestamp: "",
  port_id: "",
  description: "",
  is_delay: false,
  delay_reason: "",
};

export default function VoyagesPage() {
  const { backendUser } = useAuth();

  // Role permissions based strictly on backend implementation
  const role = backendUser?.role?.toLowerCase() || "viewer";
  const canMutate = role === "admin" || role === "manager" || role === "operator";
  const canDelete = role === "admin" || role === "manager";

  // Unique control IDs
  const statusFilterId = useId();
  const vesselFilterId = useId();

  // Relational Lookup Data (Vessels & Ports in organization)
  const [vesselsList, setVesselsList] = useState<VesselListItem[]>([]);
  const [portsList, setPortsList] = useState<PortListItem[]>([]);

  // List data state
  const [voyages, setVoyages] = useState<VoyageListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [statusFilter, setStatusFilter] = useState("");
  const [vesselFilter, setVesselFilter] = useState("");

  // Modals state: Create / Edit Voyage
  const [isVoyageFormOpen, setIsVoyageFormOpen] = useState(false);
  const [editingVoyage, setEditingVoyage] = useState<VoyageListItem | null>(null);
  const [voyageFormData, setVoyageFormData] = useState<VoyageFormData>(initialVoyageFormData);
  const [voyageFormErrors, setVoyageFormErrors] = useState<Record<string, string>>({});
  const [isSubmittingVoyage, setIsSubmittingVoyage] = useState(false);
  const [voyageServerError, setVoyageServerError] = useState<string | null>(null);

  // Detail Modal state
  const [detailVoyageId, setDetailVoyageId] = useState<string | null>(null);
  const [detailVoyage, setDetailVoyage] = useState<VoyageRead | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Event Creation Modal state
  const [isEventFormOpen, setIsEventFormOpen] = useState(false);
  const [eventFormData, setEventFormData] = useState<EventFormData>(initialEventFormData);
  const [eventFormErrors, setEventFormErrors] = useState<Record<string, string>>({});
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);
  const [eventServerError, setEventServerError] = useState<string | null>(null);

  // Delete Dialog state
  const [voyageToDelete, setVoyageToDelete] = useState<VoyageListItem | null>(null);
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

  // Load lookup options for Vessels and Ports once (avoids N+1 requests)
  useEffect(() => {
    listVessels({ page_size: 100 })
      .then((res) => setVesselsList(res.items))
      .catch(() => {});

    listPorts({ page_size: 100 })
      .then((res) => setPortsList(res.items))
      .catch(() => {});
  }, []);

  // Lookup maps for O(1) rendering
  const vesselsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vesselsList) {
      map.set(v.id, v.name);
    }
    return map;
  }, [vesselsList]);

  const portsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of portsList) {
      map.set(p.id, `${p.name} (${p.unlocode})`);
    }
    return map;
  }, [portsList]);

  // Lock body scroll when any modal is open
  const isAnyModalOpen =
    isVoyageFormOpen || Boolean(detailVoyageId) || isEventFormOpen || Boolean(voyageToDelete);

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
        if (voyageToDelete && !isDeleting) {
          setVoyageToDelete(null);
          setDeleteError(null);
        } else if (isEventFormOpen && !isSubmittingEvent) {
          setIsEventFormOpen(false);
        } else if (detailVoyageId && !isLoadingDetail) {
          setDetailVoyageId(null);
          setDetailVoyage(null);
        } else if (isVoyageFormOpen && !isSubmittingVoyage) {
          setIsVoyageFormOpen(false);
          setEditingVoyage(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    voyageToDelete,
    isDeleting,
    isEventFormOpen,
    isSubmittingEvent,
    detailVoyageId,
    isLoadingDetail,
    isVoyageFormOpen,
    isSubmittingVoyage,
  ]);

  // Manual refresh function
  const refreshVoyages = useCallback(
    async (targetPage = page, status = statusFilter, vessel = vesselFilter) => {
      try {
        setLoading(true);
        setError(null);
        const res = await listVoyages({
          page: targetPage,
          page_size: pageSize,
          status: status || undefined,
          vessel_id: vessel || undefined,
        });
        setVoyages(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages || 1);
      } catch (err: unknown) {
        setError(
          getApiErrorMessage(
            err,
            "Unable to load voyages. Please check your network connection and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, statusFilter, vesselFilter]
  );

  // Synchronize voyages list on page or filter state change
  useEffect(() => {
    let ignore = false;

    listVoyages({
      page,
      page_size: pageSize,
      status: statusFilter || undefined,
      vessel_id: vesselFilter || undefined,
    })
      .then((res) => {
        if (!ignore) {
          setVoyages(res.items);
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
              "Unable to load voyages. Please check your network connection and try again."
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
  }, [page, pageSize, statusFilter, vesselFilter]);

  // Open Create Voyage Modal
  const handleOpenCreate = () => {
    setEditingVoyage(null);
    setVoyageFormData({
      ...initialVoyageFormData,
      vessel_id: vesselsList.length > 0 ? vesselsList[0].id : "",
    });
    setVoyageFormErrors({});
    setVoyageServerError(null);
    setIsVoyageFormOpen(true);
  };

  // Open Edit Voyage Modal
  const handleOpenEdit = (voyage: VoyageListItem) => {
    setEditingVoyage(voyage);
    setVoyageFormData({
      vessel_id: voyage.vessel_id,
      voyage_number: voyage.voyage_number,
      origin_port_id: voyage.origin_port_id || "",
      destination_port_id: voyage.destination_port_id || "",
      departure_date: toDateTimeLocal(voyage.departure_date),
      arrival_date: toDateTimeLocal(voyage.arrival_date),
      status: voyage.status || "planned",
      cargo_type: voyage.cargo_type || "",
      cargo_quantity: voyage.cargo_quantity !== null ? String(voyage.cargo_quantity) : "",
    });
    setVoyageFormErrors({});
    setVoyageServerError(null);
    setIsVoyageFormOpen(true);
  };

  // Validate Voyage form before submission
  const validateVoyageForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!voyageFormData.vessel_id) {
      errors.vessel_id = "Assigned vessel is required.";
    }

    if (!voyageFormData.voyage_number.trim()) {
      errors.voyage_number = "Voyage number is required.";
    } else if (voyageFormData.voyage_number.trim().length > 100) {
      errors.voyage_number = "Voyage number cannot exceed 100 characters.";
    }

    if (voyageFormData.departure_date && voyageFormData.arrival_date) {
      const dep = new Date(voyageFormData.departure_date);
      const arr = new Date(voyageFormData.arrival_date);
      if (arr < dep) {
        errors.arrival_date = "Arrival date cannot be earlier than departure date.";
      }
    }

    if (voyageFormData.cargo_quantity) {
      const qty = parseFloat(voyageFormData.cargo_quantity);
      if (isNaN(qty) || qty < 0) {
        errors.cargo_quantity = "Cargo quantity must be a non-negative number.";
      }
    }

    setVoyageFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Create or Edit Voyage
  const handleVoyageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateVoyageForm() || isSubmittingVoyage) return;

    setIsSubmittingVoyage(true);
    setVoyageServerError(null);

    const payload: VoyageCreatePayload | VoyageUpdatePayload = {
      vessel_id: voyageFormData.vessel_id,
      voyage_number: voyageFormData.voyage_number.trim(),
      origin_port_id: voyageFormData.origin_port_id || null,
      destination_port_id: voyageFormData.destination_port_id || null,
      departure_date: voyageFormData.departure_date ? new Date(voyageFormData.departure_date).toISOString() : null,
      arrival_date: voyageFormData.arrival_date ? new Date(voyageFormData.arrival_date).toISOString() : null,
      status: voyageFormData.status.toLowerCase().trim(),
      cargo_type: voyageFormData.cargo_type.trim() || null,
      cargo_quantity: voyageFormData.cargo_quantity ? parseFloat(voyageFormData.cargo_quantity) : null,
    };

    try {
      if (editingVoyage) {
        await updateVoyage(editingVoyage.id, payload as VoyageUpdatePayload);
        setFeedback({
          type: "success",
          message: `Voyage "${payload.voyage_number}" updated successfully.`,
        });
      } else {
        await createVoyage(payload as VoyageCreatePayload);
        setFeedback({
          type: "success",
          message: `Voyage "${payload.voyage_number}" created successfully.`,
        });
      }
      setIsVoyageFormOpen(false);
      setEditingVoyage(null);
      refreshVoyages(page, statusFilter, vesselFilter);
    } catch (err: unknown) {
      setVoyageServerError(
        getApiErrorMessage(
          err,
          editingVoyage ? "Failed to update voyage." : "Failed to create voyage."
        )
      );
    } finally {
      setIsSubmittingVoyage(false);
    }
  };

  // Open Voyage Detail View
  const handleOpenDetail = async (voyageId: string) => {
    setDetailVoyageId(voyageId);
    setIsLoadingDetail(true);
    try {
      const res = await getVoyage(voyageId);
      setDetailVoyage(res);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to load voyage details."),
      });
      setDetailVoyageId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Open Add Event Modal
  const handleOpenAddEvent = () => {
    const nowLocal = toDateTimeLocal(new Date().toISOString());
    setEventFormData({
      ...initialEventFormData,
      timestamp: nowLocal,
      port_id: detailVoyage?.origin_port_id || "",
    });
    setEventFormErrors({});
    setEventServerError(null);
    setIsEventFormOpen(true);
  };

  // Validate Event Form
  const validateEventForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!eventFormData.event_type.trim()) {
      errors.event_type = "Event type is required.";
    }

    if (!eventFormData.timestamp) {
      errors.timestamp = "Event timestamp is required.";
    }

    if (eventFormData.timestamp && eventFormData.end_timestamp) {
      const start = new Date(eventFormData.timestamp);
      const end = new Date(eventFormData.end_timestamp);
      if (end < start) {
        errors.end_timestamp = "End timestamp cannot be earlier than start timestamp.";
      }
    }

    if (eventFormData.is_delay && !eventFormData.delay_reason.trim()) {
      errors.delay_reason = "Reason is required when logging an operational delay.";
    }

    setEventFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Voyage Event
  const handleEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailVoyage || !validateEventForm() || isSubmittingEvent) return;

    setIsSubmittingEvent(true);
    setEventServerError(null);

    const payload: VoyageEventCreatePayload = {
      event_type: eventFormData.event_type.trim().toUpperCase(),
      timestamp: new Date(eventFormData.timestamp).toISOString(),
      end_timestamp: eventFormData.end_timestamp ? new Date(eventFormData.end_timestamp).toISOString() : null,
      port_id: eventFormData.port_id || null,
      description: eventFormData.description.trim() || null,
      is_delay: eventFormData.is_delay,
      delay_reason: eventFormData.is_delay ? eventFormData.delay_reason.trim() : null,
    };

    try {
      await createVoyageEvent(detailVoyage.id, payload);
      setFeedback({
        type: "success",
        message: `Milestone event "${formatEventType(payload.event_type)}" logged successfully.`,
      });
      setIsEventFormOpen(false);
      // Refresh voyage detail to reload full event list
      const updatedVoyage = await getVoyage(detailVoyage.id);
      setDetailVoyage(updatedVoyage);
    } catch (err: unknown) {
      setEventServerError(getApiErrorMessage(err, "Failed to log voyage event."));
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  // Confirm and Execute Voyage Deletion
  const handleDeleteConfirm = async () => {
    if (!voyageToDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteVoyage(voyageToDelete.id);
      setFeedback({
        type: "success",
        message: `Voyage "${voyageToDelete.voyage_number}" deleted successfully.`,
      });
      setVoyageToDelete(null);
      const newPage = voyages.length === 1 && page > 1 ? page - 1 : page;
      setPage(newPage);
      refreshVoyages(newPage, statusFilter, vesselFilter);
    } catch (err: unknown) {
      setDeleteError(getApiErrorMessage(err, "Failed to delete voyage record."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Page Header */}
      <PageHeader
        title="Voyage Management"
        description="Real-time voyage planning, port rotation itineraries, cargo manifests, and operational laytime event tracking."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Voyages" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshVoyages(page, statusFilter, vesselFilter)}
              disabled={loading}
              title="Refresh voyages list"
              aria-label="Refresh voyage list"
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
                <span>Create Voyage</span>
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
            onClick={() => refreshVoyages(page, statusFilter, vesselFilter)}
            className="gap-1.5 text-xs"
          >
            <RefreshIcon size={13} />
            <span>Retry Connection</span>
          </Button>
        </Card>
      )}

      {/* Filters Toolbar */}
      <Card className="p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Status Filter */}
          <div className="w-full sm:w-48">
            <label htmlFor={statusFilterId} className="sr-only">
              Filter by voyage status
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
              {VOYAGE_STATUSES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          {/* Vessel Filter */}
          <div className="w-full sm:w-56">
            <label htmlFor={vesselFilterId} className="sr-only">
              Filter by operating vessel
            </label>
            <select
              id={vesselFilterId}
              value={vesselFilter}
              onChange={(e) => {
                setVesselFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-700"
            >
              <option value="">All Operating Vessels</option>
              {vesselsList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.imo_number})
                </option>
              ))}
            </select>
          </div>

          {(statusFilter || vesselFilter) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("");
                setVesselFilter("");
                setPage(1);
              }}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Reset Filters
            </Button>
          )}
        </div>
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

        {/* Empty State: No voyages in organization */}
        {!loading && !error && total === 0 && !statusFilter && !vesselFilter && (
          <EmptyState
            icon={<VoyagesIcon size={24} />}
            badgeText="Operational Tracking"
            title="No Voyages Registered Yet"
            description="Your organization does not have any active or planned voyages. Register your voyages to log milestone events, port calls, laytime logs, and cargo manifests."
            action={
              canMutate ? (
                <Button variant="primary" size="sm" onClick={handleOpenCreate} className="gap-1.5 text-xs">
                  <PlusIcon size={14} />
                  <span>Create First Voyage</span>
                </Button>
              ) : undefined
            }
          />
        )}

        {/* Empty State: Filter yielded no results */}
        {!loading && !error && total === 0 && (statusFilter || vesselFilter) && (
          <EmptyState
            icon={<SearchIcon size={24} />}
            badgeText="Search Results"
            title="No Voyages Match Your Filters"
            description="No voyages in your organization matched your selected status or vessel filter."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatusFilter("");
                  setVesselFilter("");
                }}
                className="gap-1.5 text-xs"
              >
                <span>Reset All Filters</span>
              </Button>
            }
          />
        )}

        {/* Voyage Records (Desktop Table & Mobile Stacked Cards) */}
        {!loading && !error && voyages.length > 0 && (
          <Card className="overflow-hidden shadow-xs">
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Voyages registry table">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="py-3 pl-5 pr-3">Voyage No.</th>
                    <th scope="col" className="px-3 py-3">Operating Vessel</th>
                    <th scope="col" className="px-3 py-3">Itinerary Route</th>
                    <th scope="col" className="px-3 py-3">Departure</th>
                    <th scope="col" className="px-3 py-3">Arrival</th>
                    <th scope="col" className="px-3 py-3">Cargo Manifest</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="py-3 pl-3 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {voyages.map((vy) => (
                    <tr key={vy.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pl-5 pr-3 font-semibold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(vy.id)}
                          className="text-left font-mono font-bold text-blue-600 hover:underline cursor-pointer"
                          title={`View details for Voyage ${vy.voyage_number}`}
                        >
                          {vy.voyage_number}
                        </button>
                      </td>
                      <td className="px-3 py-3.5 text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {vesselsMap.get(vy.vessel_id) || "Assigned Vessel"}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 max-w-xs truncate">
                        {vy.origin_port_id || vy.destination_port_id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-slate-700">
                              {vy.origin_port_id ? portsMap.get(vy.origin_port_id) || "Origin" : "—"}
                            </span>
                            <span className="text-slate-400">→</span>
                            <span className="font-medium text-slate-700">
                              {vy.destination_port_id ? portsMap.get(vy.destination_port_id) || "Destination" : "—"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatDateTime(vy.departure_date)}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatDateTime(vy.arrival_date)}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {vy.cargo_type ? (
                          <span>
                            {vy.cargo_type}
                            {vy.cargo_quantity !== null && (
                              <span className="ml-1 text-slate-400 font-mono text-[11px]">
                                ({formatNumber(vy.cargo_quantity)} MT)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <VoyageStatusBadge status={vy.status} />
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetail(vy.id)}
                            title="View voyage details & timeline"
                            aria-label={`View details of Voyage ${vy.voyage_number}`}
                            className="p-1.5 text-slate-500 hover:text-blue-600"
                          >
                            <EyeIcon size={15} />
                          </Button>

                          {canMutate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEdit(vy)}
                              title="Edit voyage particulars"
                              aria-label={`Edit Voyage ${vy.voyage_number}`}
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
                                setVoyageToDelete(vy);
                                setDeleteError(null);
                              }}
                              title="Delete voyage"
                              aria-label={`Delete Voyage ${vy.voyage_number}`}
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
            <div className="lg:hidden divide-y divide-slate-100">
              {voyages.map((vy) => (
                <div key={vy.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(vy.id)}
                        className="text-left font-mono font-bold text-blue-600 hover:underline text-sm"
                      >
                        Voyage {vy.voyage_number}
                      </button>
                      <p className="text-xs font-semibold text-slate-700">
                        {vesselsMap.get(vy.vessel_id) || "Assigned Vessel"}
                      </p>
                    </div>
                    <VoyageStatusBadge status={vy.status} />
                  </div>

                  <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-50">
                    <div>
                      <span className="text-slate-400">Route:</span>{" "}
                      <span className="font-medium text-slate-700">
                        {vy.origin_port_id ? portsMap.get(vy.origin_port_id) || "Origin" : "—"} →{" "}
                        {vy.destination_port_id ? portsMap.get(vy.destination_port_id) || "Destination" : "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 font-mono">
                      <div>Dep: {formatDateTime(vy.departure_date)}</div>
                      <div>Arr: {formatDateTime(vy.arrival_date)}</div>
                    </div>
                    {vy.cargo_type && (
                      <div className="text-[11px] text-slate-500">
                        Cargo: {vy.cargo_type}{" "}
                        {vy.cargo_quantity !== null ? `(${formatNumber(vy.cargo_quantity)} MT)` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDetail(vy.id)}
                      className="gap-1 text-xs"
                    >
                      <EyeIcon size={13} />
                      <span>Timeline</span>
                    </Button>

                    {canMutate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(vy)}
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
                          setVoyageToDelete(vy);
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
                  <span className="font-semibold">{totalPages}</span> ({total} voyages total)
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
          MODAL: Create or Edit Voyage
      ────────────────────────────────────────────────────────────────────────── */}
      {isVoyageFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voyage-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingVoyage) {
              setIsVoyageFormOpen(false);
              setEditingVoyage(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                  <VoyagesIcon size={18} />
                </div>
                <div>
                  <h3 id="voyage-form-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    {editingVoyage ? `Edit Voyage: ${editingVoyage.voyage_number}` : "Create Commercial Voyage"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingVoyage
                      ? "Update voyage schedule, rotation nodes, and cargo payload"
                      : "Schedule a new operational voyage with origin and destination port calls"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingVoyage) {
                    setIsVoyageFormOpen(false);
                    setEditingVoyage(null);
                  }
                }}
                disabled={isSubmittingVoyage}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleVoyageSubmit} className="p-4 sm:p-5 space-y-4">
              {voyageServerError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {voyageServerError}
                </div>
              )}

              {/* Vessel & Voyage Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="voyage_vessel_id" className="block text-xs font-semibold text-slate-700 mb-1">
                    Operating Vessel <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="voyage_vessel_id"
                    required
                    value={voyageFormData.vessel_id}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, vessel_id: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white font-medium"
                  >
                    <option value="">Select fleet vessel...</option>
                    {vesselsList.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.imo_number})
                      </option>
                    ))}
                  </select>
                  {voyageFormErrors.vessel_id && (
                    <p className="text-[11px] text-red-600 mt-1">{voyageFormErrors.vessel_id}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="voyage_number" className="block text-xs font-semibold text-slate-700 mb-1">
                    Voyage Number / Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="voyage_number"
                    type="text"
                    required
                    value={voyageFormData.voyage_number}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, voyage_number: e.target.value }))}
                    placeholder="e.g. V-2026-001"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono font-semibold"
                  />
                  {voyageFormErrors.voyage_number && (
                    <p className="text-[11px] text-red-600 mt-1">{voyageFormErrors.voyage_number}</p>
                  )}
                </div>
              </div>

              {/* Origin Port & Destination Port */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="voyage_origin_port" className="block text-xs font-semibold text-slate-700 mb-1">
                    Origin Port Call
                  </label>
                  <select
                    id="voyage_origin_port"
                    value={voyageFormData.origin_port_id}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, origin_port_id: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Unassigned port</option>
                    {portsList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unlocode}) - {p.country}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="voyage_destination_port" className="block text-xs font-semibold text-slate-700 mb-1">
                    Destination Port Call
                  </label>
                  <select
                    id="voyage_destination_port"
                    value={voyageFormData.destination_port_id}
                    onChange={(e) =>
                      setVoyageFormData((prev) => ({ ...prev, destination_port_id: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">Unassigned port</option>
                    {portsList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unlocode}) - {p.country}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Departure and Arrival Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="voyage_departure_date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Estimated Departure
                  </label>
                  <input
                    id="voyage_departure_date"
                    type="datetime-local"
                    value={voyageFormData.departure_date}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, departure_date: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="voyage_arrival_date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Estimated Arrival
                  </label>
                  <input
                    id="voyage_arrival_date"
                    type="datetime-local"
                    value={voyageFormData.arrival_date}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, arrival_date: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {voyageFormErrors.arrival_date && (
                    <p className="text-[11px] text-red-600 mt-1">{voyageFormErrors.arrival_date}</p>
                  )}
                </div>
              </div>

              {/* Cargo Type, Quantity, and Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="voyage_cargo_type" className="block text-xs font-semibold text-slate-700 mb-1">
                    Cargo Manifest Type
                  </label>
                  <input
                    id="voyage_cargo_type"
                    type="text"
                    value={voyageFormData.cargo_type}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, cargo_type: e.target.value }))}
                    placeholder="e.g. Iron Ore"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="voyage_cargo_quantity" className="block text-xs font-semibold text-slate-700 mb-1">
                    Quantity (MT)
                  </label>
                  <input
                    id="voyage_cargo_quantity"
                    type="number"
                    step="any"
                    min="0"
                    value={voyageFormData.cargo_quantity}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, cargo_quantity: e.target.value }))}
                    placeholder="e.g. 75000"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  />
                  {voyageFormErrors.cargo_quantity && (
                    <p className="text-[11px] text-red-600 mt-1">{voyageFormErrors.cargo_quantity}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="voyage_status" className="block text-xs font-semibold text-slate-700 mb-1">
                    Voyage Status <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="voyage_status"
                    value={voyageFormData.status}
                    onChange={(e) => setVoyageFormData((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="planned">Planned</option>
                    <option value="in_transit">In Transit</option>
                    <option value="berthed">Berthed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsVoyageFormOpen(false);
                    setEditingVoyage(null);
                  }}
                  disabled={isSubmittingVoyage}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmittingVoyage}
                  className="gap-1.5 text-xs min-w-28 justify-center shadow-xs"
                >
                  {isSubmittingVoyage ? (
                    <>
                      <SpinnerIcon size={12} />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingVoyage ? "Update Voyage" : "Create Voyage"}</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Voyage Details & Operational Event Timeline
      ────────────────────────────────────────────────────────────────────────── */}
      {detailVoyageId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voyage-detail-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLoadingDetail) {
              setDetailVoyageId(null);
              setDetailVoyage(null);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                  <VoyagesIcon size={18} />
                </div>
                <div>
                  <h3 id="voyage-detail-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    Voyage {detailVoyage?.voyage_number || "Details"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Operating Vessel: {detailVoyage ? vesselsMap.get(detailVoyage.vessel_id) || "Assigned Vessel" : "..."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailVoyageId(null);
                  setDetailVoyage(null);
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close details"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-5">
              {isLoadingDetail && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <SpinnerIcon size={24} />
                  <p className="text-xs">Loading operational timeline...</p>
                </div>
              )}

              {!isLoadingDetail && detailVoyage && (
                <>
                  {/* Status Banner */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600">Voyage Status:</span>
                      <VoyageStatusBadge status={detailVoyage.status} />
                    </div>
                    {canMutate && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleOpenAddEvent}
                        className="gap-1.5 text-xs shadow-xs"
                      >
                        <PlusIcon size={13} />
                        <span>Log Operational Event</span>
                      </Button>
                    )}
                  </div>

                  {/* Summary Particulars Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Origin Port</span>
                      <span className="font-semibold text-slate-800">
                        {detailVoyage.origin_port_id ? portsMap.get(detailVoyage.origin_port_id) || "Port Assigned" : "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Destination Port</span>
                      <span className="font-semibold text-slate-800">
                        {detailVoyage.destination_port_id ? portsMap.get(detailVoyage.destination_port_id) || "Port Assigned" : "—"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Cargo Payload</span>
                      <span className="font-semibold text-slate-800">
                        {detailVoyage.cargo_type || "None"}
                        {detailVoyage.cargo_quantity !== null && ` (${formatNumber(detailVoyage.cargo_quantity)} MT)`}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Departure Schedule</span>
                      <span className="font-mono text-slate-800">{formatDateTime(detailVoyage.departure_date)}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Arrival Schedule</span>
                      <span className="font-mono text-slate-800">{formatDateTime(detailVoyage.arrival_date)}</span>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-400 block text-[11px] mb-0.5">Total Milestones</span>
                      <span className="font-mono font-bold text-slate-800">
                        {detailVoyage.events ? detailVoyage.events.length : 0} events
                      </span>
                    </div>
                  </div>

                  {/* Operational Event Timeline Section */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Operational Milestone Timeline
                      </h4>
                      <span className="text-[11px] text-slate-400">Chronological order</span>
                    </div>

                    {(!detailVoyage.events || detailVoyage.events.length === 0) && (
                      <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg space-y-2 bg-slate-50/50">
                        <p className="text-xs font-medium text-slate-600">
                          No operational events recorded for this voyage.
                        </p>
                        {canMutate && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpenAddEvent}
                            className="gap-1.5 text-xs"
                          >
                            <PlusIcon size={12} />
                            <span>Add First Operational Event</span>
                          </Button>
                        )}
                      </div>
                    )}

                    {detailVoyage.events && detailVoyage.events.length > 0 && (
                      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                        {detailVoyage.events.map((evt: VoyageEventRead) => (
                          <div key={evt.id} className="relative group">
                            {/* Timeline bullet */}
                            <div
                              className={`absolute -left-6 top-1.5 w-3 h-3 rounded-full border-2 bg-white ${
                                evt.is_delay ? "border-amber-500 bg-amber-50" : "border-blue-600 bg-blue-50"
                              }`}
                            />

                            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 space-y-1.5 hover:bg-slate-50 transition-colors">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-xs text-slate-900">
                                    {formatEventType(evt.event_type)}
                                  </span>
                                  {evt.is_delay && (
                                    <Badge variant="warning" size="sm">
                                      Delay
                                    </Badge>
                                  )}
                                </div>
                                <span className="font-mono text-[11px] text-slate-500">
                                  {formatDateTime(evt.timestamp)}
                                </span>
                              </div>

                              {evt.port_id && (
                                <p className="text-[11px] text-slate-600 flex items-center gap-1">
                                  <span className="text-slate-400">Port call:</span>
                                  <span className="font-medium">{portsMap.get(evt.port_id) || "Port Call"}</span>
                                </p>
                              )}

                              {evt.end_timestamp && (
                                <p className="text-[11px] text-slate-500 font-mono">
                                  Duration: {formatDateTime(evt.timestamp)} → {formatDateTime(evt.end_timestamp)}
                                </p>
                              )}

                              {evt.description && (
                                <p className="text-xs text-slate-700 leading-relaxed pt-0.5">{evt.description}</p>
                              )}

                              {evt.is_delay && evt.delay_reason && (
                                <div className="p-2 rounded bg-amber-50 border border-amber-200/60 text-[11px] text-amber-900">
                                  <span className="font-semibold">Delay Reason:</span> {evt.delay_reason}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 sm:p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
              <Link
                href="/documents"
                className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
              >
                <span>Link Charter Parties &amp; NORs</span>
                <ChevronRightIcon size={12} />
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDetailVoyageId(null);
                  setDetailVoyage(null);
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
          MODAL: Log Operational Event
      ────────────────────────────────────────────────────────────────────────── */}
      {isEventFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingEvent) {
              setIsEventFormOpen(false);
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto my-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <VoyagesIcon size={18} />
                </div>
                <div>
                  <h3 id="event-form-modal-title" className="text-sm sm:text-base font-semibold text-slate-900">
                    Log Milestone Event
                  </h3>
                  <p className="text-xs text-slate-500">
                    Record operational status, Notice of Readiness, berthing, or delay
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingEvent) {
                    setIsEventFormOpen(false);
                  }
                }}
                disabled={isSubmittingEvent}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleEventSubmit} className="p-4 sm:p-5 space-y-4">
              {eventServerError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {eventServerError}
                </div>
              )}

              {/* Event Type */}
              <div>
                <label htmlFor="evt_type" className="block text-xs font-semibold text-slate-700 mb-1">
                  Operational Milestone Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="evt_type"
                  required
                  value={eventFormData.event_type}
                  onChange={(e) => setEventFormData((prev) => ({ ...prev, event_type: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white font-medium"
                >
                  {COMMON_EVENT_TYPES.map((et) => (
                    <option key={et.value} value={et.value}>
                      {et.label}
                    </option>
                  ))}
                </select>
                {eventFormErrors.event_type && (
                  <p className="text-[11px] text-red-600 mt-1">{eventFormErrors.event_type}</p>
                )}
              </div>

              {/* Timestamp and End Timestamp */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label htmlFor="evt_timestamp" className="block text-xs font-semibold text-slate-700 mb-1">
                    Event Timestamp <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="evt_timestamp"
                    type="datetime-local"
                    required
                    value={eventFormData.timestamp}
                    onChange={(e) => setEventFormData((prev) => ({ ...prev, timestamp: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {eventFormErrors.timestamp && (
                    <p className="text-[11px] text-red-600 mt-1">{eventFormErrors.timestamp}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="evt_end_timestamp" className="block text-xs font-semibold text-slate-700 mb-1">
                    Completion Timestamp
                  </label>
                  <input
                    id="evt_end_timestamp"
                    type="datetime-local"
                    value={eventFormData.end_timestamp}
                    onChange={(e) => setEventFormData((prev) => ({ ...prev, end_timestamp: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {eventFormErrors.end_timestamp && (
                    <p className="text-[11px] text-red-600 mt-1">{eventFormErrors.end_timestamp}</p>
                  )}
                </div>
              </div>

              {/* Associated Port Call */}
              <div>
                <label htmlFor="evt_port_id" className="block text-xs font-semibold text-slate-700 mb-1">
                  Associated Port Call
                </label>
                <select
                  id="evt_port_id"
                  value={eventFormData.port_id}
                  onChange={(e) => setEventFormData((prev) => ({ ...prev, port_id: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">At Sea / No Port Association</option>
                  {portsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unlocode}) - {p.country}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="evt_desc" className="block text-xs font-semibold text-slate-700 mb-1">
                  Operational Description / Log Notes
                </label>
                <textarea
                  id="evt_desc"
                  rows={2}
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g. Master tendered Notice of Readiness upon anchoring at pilot station..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Delay Toggle and Reason */}
              <div className="space-y-2 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eventFormData.is_delay}
                    onChange={(e) =>
                      setEventFormData((prev) => ({
                        ...prev,
                        is_delay: e.target.checked,
                        event_type: e.target.checked ? "DELAY" : prev.event_type,
                      }))
                    }
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  <span className="text-xs font-medium text-slate-800">
                    Flag as Laytime Delay / Incident
                  </span>
                </label>

                {eventFormData.is_delay && (
                  <div>
                    <label htmlFor="evt_delay_reason" className="block text-xs font-semibold text-amber-900 mb-1">
                      Delay Reason / Off-Hire Cause <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="evt_delay_reason"
                      type="text"
                      required
                      value={eventFormData.delay_reason}
                      onChange={(e) => setEventFormData((prev) => ({ ...prev, delay_reason: e.target.value }))}
                      placeholder="e.g. Adverse weather / Port berth congestion / Crane breakdown"
                      className="w-full px-3 py-2 text-xs border border-amber-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-amber-50/30"
                    />
                    {eventFormErrors.delay_reason && (
                      <p className="text-[11px] text-red-600 mt-1">{eventFormErrors.delay_reason}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEventFormOpen(false)}
                  disabled={isSubmittingEvent}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmittingEvent}
                  className="gap-1.5 text-xs min-w-28 justify-center shadow-xs"
                >
                  {isSubmittingEvent ? (
                    <>
                      <SpinnerIcon size={12} />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Log Milestone</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL: Delete Voyage Confirmation (Manager / Admin Only)
      ────────────────────────────────────────────────────────────────────────── */}
      {voyageToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-voyage-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setVoyageToDelete(null);
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
                <h3 id="delete-voyage-dialog-title" className="text-base font-semibold text-slate-900">
                  Delete Voyage Record
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to delete Voyage{" "}
                  <span className="font-mono font-bold text-slate-800">{voyageToDelete.voyage_number}</span>{" "}
                  ({vesselsMap.get(voyageToDelete.vessel_id) || "Assigned Vessel"})? All associated milestone
                  events will also be removed.
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
                  setVoyageToDelete(null);
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
