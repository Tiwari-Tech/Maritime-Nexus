"use client";

import React, { useState, useEffect, useCallback, useId, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  createContractClause,
  updateContractClause,
  deleteContractClause,
  listVessels,
  listDocuments,
  ContractListItem,
  ContractRead,
  ContractClauseRead,
  ContractCreatePayload,
  ContractUpdatePayload,
  ContractClauseCreatePayload,
  ContractClauseUpdatePayload,
  VesselListItem,
  DocumentListItem,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  ContractsIcon,
  PlusIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  EyeIcon,
  RefreshIcon,
  SpinnerIcon,
  CloseIcon,
  DocumentsIcon,
  VesselsIcon,
} from "@/components/icons";

const CONTRACT_STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending", label: "Pending" },
];

const COMMON_CONTRACT_TYPES = [
  "Voyage Charter",
  "Time Charter",
  "Bareboat Charter",
  "Contract of Affreightment (COA)",
  "Spot Fixture",
  "Consecutive Voyage",
  "Sub-Charter",
];

const COMMON_CLAUSE_TYPES = [
  "Laytime",
  "Demurrage",
  "Despatch",
  "Freight",
  "Loading & Discharging",
  "Notice of Readiness",
  "War Risk",
  "Cancellation",
  "Lien & Cesser",
  "Bunkering",
  "Arbitration",
  "General Average",
  "Exceptions",
  "Ice Clause",
  "Cargo Care",
  "Commission",
];

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}

function formatHours(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  return `${val} hrs`;
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
  if (s === "pending") {
    return <Badge variant="warning" size="sm">Pending</Badge>;
  }
  return <Badge variant="outline" size="sm">{status}</Badge>;
}

interface ContractFormData {
  contract_reference: string;
  contract_type: string;
  vessel_id: string;
  document_id: string;
  charterer: string;
  owner: string;
  broker: string;
  commencement_date: string;
  expiration_date: string;
  demurrage_rate_daily: string;
  despatch_rate_daily: string;
  laytime_allowed_hours: string;
  status: string;
}

const initialContractFormData: ContractFormData = {
  contract_reference: "",
  contract_type: "Voyage Charter",
  vessel_id: "",
  document_id: "",
  charterer: "",
  owner: "",
  broker: "",
  commencement_date: "",
  expiration_date: "",
  demurrage_rate_daily: "",
  despatch_rate_daily: "",
  laytime_allowed_hours: "",
  status: "active",
};

interface ClauseFormData {
  clause_number: string;
  clause_title: string;
  clause_type: string;
  clause_text: string;
  order_index: number;
  document_chunk_id: string;
}

const initialClauseFormData: ClauseFormData = {
  clause_number: "",
  clause_title: "",
  clause_type: "Laytime",
  clause_text: "",
  order_index: 0,
  document_chunk_id: "",
};

export default function ContractsPage() {
  const { backendUser } = useAuth();

  // Role permissions strictly aligned with backend RBAC
  const role = backendUser?.role?.toLowerCase() || "viewer";
  const canMutate = role === "admin" || role === "manager" || role === "operator";
  const canDelete = role === "admin" || role === "manager";

  // Filter IDs
  const searchInputId = useId();
  const statusFilterId = useId();
  const typeFilterId = useId();
  const vesselFilterId = useId();
  const documentFilterId = useId();

  // List State
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [vesselFilter, setVesselFilter] = useState("");
  const [documentFilter, setDocumentFilter] = useState("");

  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Relational Lookups
  const [vessels, setVessels] = useState<VesselListItem[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Clause Modals
  const [clauseModalOpen, setClauseModalOpen] = useState(false);
  const [editingClause, setEditingClause] = useState<ContractClauseRead | null>(null);
  const [deleteClauseModalOpen, setDeleteClauseModalOpen] = useState(false);
  const [clauseToDelete, setClauseToDelete] = useState<ContractClauseRead | null>(null);

  // Target Contract for Edit / Detail / Delete
  const [selectedContract, setSelectedContract] = useState<ContractRead | null>(null);
  const [contractToDelete, setContractToDelete] = useState<ContractListItem | null>(null);

  // Form States & Submitting
  const [contractForm, setContractForm] = useState<ContractFormData>(initialContractFormData);
  const [clauseForm, setClauseForm] = useState<ClauseFormData>(initialClauseFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clauseSubmitting, setClauseSubmitting] = useState(false);
  const [clauseError, setClauseError] = useState<string | null>(null);

  // Map Lookups for O(1) Access
  const vesselsMap = useMemo(() => {
    const map = new Map<string, VesselListItem>();
    vessels.forEach((v) => map.set(v.id, v));
    return map;
  }, [vessels]);

  const documentsMap = useMemo(() => {
    const map = new Map<string, DocumentListItem>();
    documents.forEach((d) => map.set(d.id, d));
    return map;
  }, [documents]);

  // Initial reference fetch for Vessels and Documents
  useEffect(() => {
    let ignore = false;
    Promise.all([
      listVessels({ page_size: 100 }),
      listDocuments({ page_size: 100 }),
    ])
      .then(([vesselRes, docRes]) => {
        if (!ignore) {
          setVessels(vesselRes.items || []);
          setDocuments(docRes.items || []);
        }
      })
      .catch((err) => {
        if (!ignore) {
          // Non-blocking lookup error
          console.error("Failed to load relational references:", err);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Manual refresh function triggered by user actions
  const refreshContracts = useCallback(
    async (
      targetPage = page,
      status = statusFilter,
      cType = typeFilter,
      vessel = vesselFilter,
      doc = documentFilter,
      search = searchQuery
    ) => {
      try {
        setLoading(true);
        setError(null);
        const res = await listContracts({
          page: targetPage,
          page_size: pageSize,
          status: status || undefined,
          contract_type: cType || undefined,
          vessel_id: vessel || undefined,
          document_id: doc || undefined,
          search: search.trim() || undefined,
        });
        setContracts(res.items || []);
        setTotal(res.total);
        setTotalPages(res.total_pages || 1);
      } catch (err: unknown) {
        setError(getApiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, statusFilter, typeFilter, vesselFilter, documentFilter, searchQuery]
  );

  // Synchronize contracts list on page or filter change with race-condition safety
  useEffect(() => {
    let ignore = false;

    listContracts({
      page,
      page_size: pageSize,
      status: statusFilter || undefined,
      contract_type: typeFilter || undefined,
      vessel_id: vesselFilter || undefined,
      document_id: documentFilter || undefined,
      search: searchQuery.trim() || undefined,
    })
      .then((res) => {
        if (!ignore) {
          setContracts(res.items || []);
          setTotal(res.total);
          setTotalPages(res.total_pages || 1);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(getApiErrorMessage(err));
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
  }, [page, pageSize, statusFilter, typeFilter, vesselFilter, documentFilter, searchQuery]);

  // Handle modal body scroll lock & Escape key
  const anyModalOpen =
    createModalOpen ||
    editModalOpen ||
    detailModalOpen ||
    deleteModalOpen ||
    clauseModalOpen ||
    deleteClauseModalOpen;

  useEffect(() => {
    if (anyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [anyModalOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (deleteClauseModalOpen) {
          setDeleteClauseModalOpen(false);
          setClauseToDelete(null);
        } else if (clauseModalOpen) {
          setClauseModalOpen(false);
          setEditingClause(null);
        } else if (deleteModalOpen) {
          setDeleteModalOpen(false);
          setContractToDelete(null);
        } else if (editModalOpen) {
          setEditModalOpen(false);
        } else if (createModalOpen) {
          setCreateModalOpen(false);
        } else if (detailModalOpen) {
          setDetailModalOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    createModalOpen,
    editModalOpen,
    detailModalOpen,
    deleteModalOpen,
    clauseModalOpen,
    deleteClauseModalOpen,
  ]);

  // Open Create Contract Modal
  const handleOpenCreateModal = () => {
    setContractForm(initialContractFormData);
    setFormError(null);
    setCreateModalOpen(true);
  };

  // Open Edit Contract Modal
  const handleOpenEditModal = async (contract: ContractListItem) => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      const full = await getContract(contract.id);
      setSelectedContract(full);
      setContractForm({
        contract_reference: full.contract_reference || "",
        contract_type: full.contract_type || "Voyage Charter",
        vessel_id: full.vessel_id || "",
        document_id: full.document_id || "",
        charterer: full.charterer || "",
        owner: full.owner || "",
        broker: full.broker || "",
        commencement_date: full.commencement_date || "",
        expiration_date: full.expiration_date || "",
        demurrage_rate_daily: full.demurrage_rate_daily !== null ? String(full.demurrage_rate_daily) : "",
        despatch_rate_daily: full.despatch_rate_daily !== null ? String(full.despatch_rate_daily) : "",
        laytime_allowed_hours: full.laytime_allowed_hours !== null ? String(full.laytime_allowed_hours) : "",
        status: full.status || "active",
      });
      setEditModalOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Contract Detail & Clauses Modal
  const handleOpenDetailModal = async (contractId: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const full = await getContract(contractId);
      setSelectedContract(full);
      setDetailModalOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Refresh Contract Detail (after clause changes)
  const refreshSelectedContract = async (contractId: string) => {
    try {
      const full = await getContract(contractId);
      setSelectedContract(full);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  // Open Delete Contract Modal
  const handleOpenDeleteModal = (contract: ContractListItem) => {
    setContractToDelete(contract);
    setDeleteModalOpen(true);
  };

  // Save Contract (Create or Edit)
  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    const cleanRef = contractForm.contract_reference.trim();
    if (!cleanRef) {
      setFormError("Contract reference is required.");
      return;
    }
    const cleanType = contractForm.contract_type.trim();
    if (!cleanType) {
      setFormError("Contract type is required.");
      return;
    }

    // Dates check
    if (contractForm.commencement_date && contractForm.expiration_date) {
      if (contractForm.expiration_date < contractForm.commencement_date) {
        setFormError("Expiration date cannot be earlier than commencement date.");
        return;
      }
    }

    // Numbers check
    const demurrage = contractForm.demurrage_rate_daily.trim() !== "" ? Number(contractForm.demurrage_rate_daily) : null;
    if (demurrage !== null && (isNaN(demurrage) || demurrage < 0)) {
      setFormError("Demurrage daily rate must be a non-negative number.");
      return;
    }
    const despatch = contractForm.despatch_rate_daily.trim() !== "" ? Number(contractForm.despatch_rate_daily) : null;
    if (despatch !== null && (isNaN(despatch) || despatch < 0)) {
      setFormError("Despatch daily rate must be a non-negative number.");
      return;
    }
    const laytime = contractForm.laytime_allowed_hours.trim() !== "" ? Number(contractForm.laytime_allowed_hours) : null;
    if (laytime !== null && (isNaN(laytime) || laytime < 0)) {
      setFormError("Laytime allowed hours must be a non-negative number.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editModalOpen && selectedContract) {
        const payload: ContractUpdatePayload = {
          contract_reference: cleanRef,
          contract_type: cleanType,
          vessel_id: contractForm.vessel_id.trim() || null,
          document_id: contractForm.document_id.trim() || null,
          charterer: contractForm.charterer.trim() || null,
          owner: contractForm.owner.trim() || null,
          broker: contractForm.broker.trim() || null,
          commencement_date: contractForm.commencement_date || null,
          expiration_date: contractForm.expiration_date || null,
          demurrage_rate_daily: demurrage,
          despatch_rate_daily: despatch,
          laytime_allowed_hours: laytime,
          status: contractForm.status || "active",
        };
        await updateContract(selectedContract.id, payload);
        setEditModalOpen(false);
      } else {
        const payload: ContractCreatePayload = {
          contract_reference: cleanRef,
          contract_type: cleanType,
          vessel_id: contractForm.vessel_id.trim() || null,
          document_id: contractForm.document_id.trim() || null,
          charterer: contractForm.charterer.trim() || null,
          owner: contractForm.owner.trim() || null,
          broker: contractForm.broker.trim() || null,
          commencement_date: contractForm.commencement_date || null,
          expiration_date: contractForm.expiration_date || null,
          demurrage_rate_daily: demurrage,
          despatch_rate_daily: despatch,
          laytime_allowed_hours: laytime,
          status: contractForm.status || "active",
        };
        await createContract(payload);
        setCreateModalOpen(false);
      }
      refreshContracts();
    } catch (err) {
      setFormError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Delete Contract
  const handleConfirmDeleteContract = async () => {
    if (!contractToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteContract(contractToDelete.id);
      setDeleteModalOpen(false);
      setContractToDelete(null);
      if (selectedContract?.id === contractToDelete.id) {
        setDetailModalOpen(false);
        setSelectedContract(null);
      }
      refreshContracts();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Create Clause Modal
  const handleOpenCreateClauseModal = () => {
    if (!selectedContract) return;
    const nextOrder = selectedContract.clauses?.length || 0;
    setEditingClause(null);
    setClauseForm({
      clause_number: String(nextOrder + 1),
      clause_title: "",
      clause_type: "Laytime",
      clause_text: "",
      order_index: nextOrder,
      document_chunk_id: "",
    });
    setClauseError(null);
    setClauseModalOpen(true);
  };

  // Open Edit Clause Modal
  const handleOpenEditClauseModal = (clause: ContractClauseRead) => {
    setEditingClause(clause);
    setClauseForm({
      clause_number: clause.clause_number,
      clause_title: clause.clause_title || "",
      clause_type: clause.clause_type,
      clause_text: clause.clause_text,
      order_index: clause.order_index,
      document_chunk_id: clause.document_chunk_id || "",
    });
    setClauseError(null);
    setClauseModalOpen(true);
  };

  // Save Clause (Create or Edit)
  const handleSaveClause = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract) return;
    setClauseError(null);

    const cleanNum = clauseForm.clause_number.trim();
    if (!cleanNum) {
      setClauseError("Clause number/identifier is required.");
      return;
    }
    const cleanType = clauseForm.clause_type.trim();
    if (!cleanType) {
      setClauseError("Clause classification type is required.");
      return;
    }
    const cleanText = clauseForm.clause_text.trim();
    if (!cleanText) {
      setClauseError("Clause text is required.");
      return;
    }

    setClauseSubmitting(true);
    try {
      if (editingClause) {
        const payload: ContractClauseUpdatePayload = {
          clause_number: cleanNum,
          clause_title: clauseForm.clause_title.trim() || null,
          clause_type: cleanType,
          clause_text: cleanText,
          order_index: clauseForm.order_index >= 0 ? clauseForm.order_index : 0,
          document_chunk_id: clauseForm.document_chunk_id.trim() || null,
        };
        await updateContractClause(selectedContract.id, editingClause.id, payload);
      } else {
        const payload: ContractClauseCreatePayload = {
          clause_number: cleanNum,
          clause_title: clauseForm.clause_title.trim() || null,
          clause_type: cleanType,
          clause_text: cleanText,
          order_index: clauseForm.order_index >= 0 ? clauseForm.order_index : 0,
          document_chunk_id: clauseForm.document_chunk_id.trim() || null,
        };
        await createContractClause(selectedContract.id, payload);
      }
      setClauseModalOpen(false);
      setEditingClause(null);
      await refreshSelectedContract(selectedContract.id);
    } catch (err) {
      setClauseError(getApiErrorMessage(err));
    } finally {
      setClauseSubmitting(false);
    }
  };

  // Open Delete Clause Modal
  const handleOpenDeleteClauseModal = (clause: ContractClauseRead) => {
    setClauseToDelete(clause);
    setDeleteClauseModalOpen(true);
  };

  // Confirm Delete Clause
  const handleConfirmDeleteClause = async () => {
    if (!selectedContract || !clauseToDelete) return;
    setClauseSubmitting(true);
    try {
      await deleteContractClause(selectedContract.id, clauseToDelete.id);
      setDeleteClauseModalOpen(false);
      setClauseToDelete(null);
      await refreshSelectedContract(selectedContract.id);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setClauseSubmitting(false);
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setTypeFilter("");
    setVesselFilter("");
    setDocumentFilter("");
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    searchQuery || statusFilter || typeFilter || vesselFilter || documentFilter
  );

  return (
    <div className="space-y-6">
      {/* Top Page Header */}
      <PageHeader
        title="Contracts & Clauses"
        description="Commercial fixture agreements, charter parties, rider clauses, and contract repository."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Contracts" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshContracts()}
              disabled={loading}
              className="gap-1.5 text-xs"
              title="Refresh contract directory"
            >
              <RefreshIcon size={14} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {canMutate && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreateModal}
                className="gap-1.5 text-xs shadow-xs"
              >
                <PlusIcon size={14} />
                <span>Create Contract</span>
              </Button>
            )}
          </div>
        }
      />

      {/* Error Alert Banner */}
      {error && (
        <Card className="p-4 border-rose-200 bg-rose-50 text-rose-800 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-900">
                Contract Service Notification
              </h4>
              <p className="text-xs leading-relaxed text-rose-700">{error}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshContracts()}
                className="text-xs h-7 px-2 border-rose-300 text-rose-800 hover:bg-rose-100"
              >
                Retry
              </Button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-rose-500 hover:text-rose-700 p-1"
                aria-label="Dismiss error"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Filter and Search Toolbar */}
      <Card className="p-4 shadow-xs border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Search Input */}
          <div className="space-y-1">
            <label htmlFor={searchInputId} className="text-[11px] font-medium text-slate-600">
              Search
            </label>
            <div className="relative">
              <input
                id={searchInputId}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Reference, parties..."
                className="w-full text-xs rounded-md border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
              <span className="absolute left-2.5 top-2 text-slate-400 pointer-events-none">
                <SearchIcon size={14} />
              </span>
            </div>
          </div>

          {/* Status Filter */}
          <div className="space-y-1">
            <label htmlFor={statusFilterId} className="text-[11px] font-medium text-slate-600">
              Status
            </label>
            <select
              id={statusFilterId}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            >
              {CONTRACT_STATUSES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Contract Type Filter */}
          <div className="space-y-1">
            <label htmlFor={typeFilterId} className="text-[11px] font-medium text-slate-600">
              Contract Type
            </label>
            <input
              id={typeFilterId}
              type="text"
              list="filter-contract-types"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              placeholder="All Types"
              className="w-full text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <datalist id="filter-contract-types">
              {COMMON_CONTRACT_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </div>

          {/* Vessel Filter */}
          <div className="space-y-1">
            <label htmlFor={vesselFilterId} className="text-[11px] font-medium text-slate-600">
              Vessel
            </label>
            <select
              id={vesselFilterId}
              value={vesselFilter}
              onChange={(e) => {
                setVesselFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            >
              <option value="">All Fleet Vessels</option>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.imo_number})
                </option>
              ))}
            </select>
          </div>

          {/* Document Filter & Reset Button */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor={documentFilterId} className="text-[11px] font-medium text-slate-600">
                Source Document
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-[10px] text-brand-600 hover:text-brand-800 font-medium"
                >
                  Clear all
                </button>
              )}
            </div>
            <select
              id={documentFilterId}
              value={documentFilter}
              onChange={(e) => {
                setDocumentFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            >
              <option value="">All Documents</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Main Content Area */}
      {loading && contracts.length === 0 ? (
        <Card className="p-8 shadow-xs border-slate-200">
          <div className="space-y-4 animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-1/4"></div>
            <div className="space-y-2">
              <div className="h-10 bg-slate-100 rounded"></div>
              <div className="h-10 bg-slate-100 rounded"></div>
              <div className="h-10 bg-slate-100 rounded"></div>
              <div className="h-10 bg-slate-100 rounded"></div>
            </div>
          </div>
        </Card>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={<ContractsIcon size={24} />}
          badgeText={hasActiveFilters ? "Search Results" : "Commercial Repository"}
          title={hasActiveFilters ? "No Contracts Match Your Filters" : "No Contracts Registered"}
          description={
            hasActiveFilters
              ? "Try adjusting your query parameters or clearing your filter selections."
              : "Register charter party agreements, fixture recaps, and commercial contracts with linked fleet vessels and source documents."
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={handleResetFilters} className="text-xs">
                Reset Filters
              </Button>
            ) : canMutate ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenCreateModal}
                className="gap-1.5 text-xs shadow-xs"
              >
                <PlusIcon size={14} />
                <span>Create First Contract</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Desktop Contract Table (>= 1024px) */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold">
                    <th scope="col" className="py-3 px-4">Contract Reference</th>
                    <th scope="col" className="py-3 px-4">Type</th>
                    <th scope="col" className="py-3 px-4">Fleet Vessel</th>
                    <th scope="col" className="py-3 px-4">Counterparties</th>
                    <th scope="col" className="py-3 px-4">Term Dates</th>
                    <th scope="col" className="py-3 px-4">Laytime &amp; Rates</th>
                    <th scope="col" className="py-3 px-4">Status</th>
                    <th scope="col" className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contracts.map((c) => {
                    const linkedVessel = c.vessel_id ? vesselsMap.get(c.vessel_id) : null;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Reference */}
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <button
                            type="button"
                            onClick={() => handleOpenDetailModal(c.id)}
                            className="text-left font-mono font-bold text-brand-600 hover:text-brand-800 hover:underline flex items-center gap-1.5"
                          >
                            <span>{c.contract_reference}</span>
                          </button>
                        </td>

                        {/* Type */}
                        <td className="py-3 px-4 text-slate-700 font-medium">
                          {c.contract_type}
                        </td>

                        {/* Linked Vessel */}
                        <td className="py-3 px-4 text-slate-600">
                          {linkedVessel ? (
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-800">{linkedVessel.name}</span>
                              <span className="text-[10px] font-mono text-slate-400">{linkedVessel.imo_number}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Counterparties */}
                        <td className="py-3 px-4 text-slate-600">
                          <div className="flex flex-col gap-0.5">
                            {c.charterer && (
                              <div className="text-[11px]">
                                <span className="font-medium text-slate-700">C: </span>
                                <span>{c.charterer}</span>
                              </div>
                            )}
                            {c.owner && (
                              <div className="text-[11px]">
                                <span className="font-medium text-slate-700">O: </span>
                                <span>{c.owner}</span>
                              </div>
                            )}
                            {!c.charterer && !c.owner && <span className="text-slate-400">—</span>}
                          </div>
                        </td>

                        {/* Term Dates */}
                        <td className="py-3 px-4 text-slate-600">
                          <div className="flex flex-col text-[11px]">
                            <span>{formatDate(c.commencement_date)}</span>
                            <span className="text-slate-400 text-[10px]">to {formatDate(c.expiration_date)}</span>
                          </div>
                        </td>

                        {/* Laytime & Rates */}
                        <td className="py-3 px-4 text-slate-600">
                          <div className="flex flex-col gap-0.5 text-[11px]">
                            {c.laytime_allowed_hours !== null && (
                              <span>Laytime: {formatHours(c.laytime_allowed_hours)}</span>
                            )}
                            {c.demurrage_rate_daily !== null && (
                              <span className="text-amber-700 font-medium">
                                Dem: {formatCurrency(c.demurrage_rate_daily)}/d
                              </span>
                            )}
                            {c.laytime_allowed_hours === null && c.demurrage_rate_daily === null && (
                              <span className="text-slate-400">—</span>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4">
                          <ContractStatusBadge status={c.status} />
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDetailModal(c.id)}
                              className="h-7 w-7 p-0 text-slate-600 hover:text-slate-900"
                              title="Inspect contract details and clauses"
                            >
                              <EyeIcon size={14} />
                            </Button>
                            {canMutate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditModal(c)}
                                className="h-7 w-7 p-0 text-slate-600 hover:text-slate-900"
                                title="Edit contract terms"
                              >
                                <EditIcon size={14} />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenDeleteModal(c)}
                                className="h-7 w-7 p-0 text-rose-600 hover:text-rose-800 hover:bg-rose-50"
                                title="Delete contract"
                              >
                                <TrashIcon size={14} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Stacked Cards (< 1024px) */}
          <div className="lg:hidden space-y-3">
            {contracts.map((c) => {
              const linkedVessel = c.vessel_id ? vesselsMap.get(c.vessel_id) : null;
              return (
                <Card key={c.id} className="p-4 shadow-xs border-slate-200 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => handleOpenDetailModal(c.id)}
                        className="text-left font-mono font-bold text-sm text-brand-600 hover:text-brand-800"
                      >
                        {c.contract_reference}
                      </button>
                      <p className="text-xs text-slate-500 font-medium">{c.contract_type}</p>
                    </div>
                    <ContractStatusBadge status={c.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Fleet Vessel
                      </span>
                      <span className="text-slate-800 font-medium">
                        {linkedVessel ? linkedVessel.name : "—"}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Permitted Laytime
                      </span>
                      <span className="text-slate-800 font-medium">
                        {formatHours(c.laytime_allowed_hours)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Charterer
                      </span>
                      <span className="text-slate-800 font-medium">{c.charterer || "—"}</span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Daily Demurrage
                      </span>
                      <span className="text-amber-700 font-medium">
                        {formatCurrency(c.demurrage_rate_daily)}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                        Effective Period
                      </span>
                      <span className="text-slate-700">
                        {formatDate(c.commencement_date)} to {formatDate(c.expiration_date)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDetailModal(c.id)}
                      className="text-xs h-8 gap-1"
                    >
                      <EyeIcon size={12} />
                      <span>Details &amp; Clauses</span>
                    </Button>
                    {canMutate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEditModal(c)}
                        className="text-xs h-8 gap-1"
                      >
                        <EditIcon size={12} />
                        <span>Edit</span>
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenDeleteModal(c)}
                        className="text-xs h-8 text-rose-600 hover:text-rose-800"
                      >
                        <TrashIcon size={12} />
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-600">
              <div>
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} contracts
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="text-xs"
                >
                  Previous
                </Button>
                <span className="px-2 font-medium">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL 1: Create / Edit Contract ─── */}
      {(createModalOpen || editModalOpen) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contract-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div
            className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-brand-50 text-brand-700">
                  <ContractsIcon size={18} />
                </div>
                <h3 id="contract-modal-title" className="text-base font-semibold text-slate-900">
                  {editModalOpen ? "Edit Commercial Contract" : "Create Commercial Contract"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveContract} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-800 border border-rose-200">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Contract Reference */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Contract Reference <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={contractForm.contract_reference}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, contract_reference: e.target.value })
                    }
                    placeholder="e.g. CP-2026-GENCON-01"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <p className="text-[10px] text-slate-400">Unique identifier within organization</p>
                </div>

                {/* Contract Type */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Contract Type <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    list="modal-contract-types"
                    value={contractForm.contract_type}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, contract_type: e.target.value })
                    }
                    placeholder="e.g. Voyage Charter"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <datalist id="modal-contract-types">
                    {COMMON_CONTRACT_TYPES.map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </div>

                {/* Fleet Vessel Link */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Fleet Vessel</label>
                  <select
                    value={contractForm.vessel_id}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, vessel_id: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">No Vessel Associated</option>
                    {vessels.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.imo_number})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Source Document Link */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Source Document</label>
                  <select
                    value={contractForm.document_id}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, document_id: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">No Document Linked</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Charterer */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Charterer</label>
                  <input
                    type="text"
                    maxLength={255}
                    value={contractForm.charterer}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, charterer: e.target.value })
                    }
                    placeholder="e.g. Atlantic Grain Exporters"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Owner */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Vessel Owner</label>
                  <input
                    type="text"
                    maxLength={255}
                    value={contractForm.owner}
                    onChange={(e) => setContractForm({ ...contractForm, owner: e.target.value })}
                    placeholder="e.g. Maritime Chartering Ltd"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Broker */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Intermediary Broker</label>
                  <input
                    type="text"
                    maxLength={255}
                    value={contractForm.broker}
                    onChange={(e) => setContractForm({ ...contractForm, broker: e.target.value })}
                    placeholder="e.g. Braemar Seascope"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Status</label>
                  <select
                    value={contractForm.status}
                    onChange={(e) => setContractForm({ ...contractForm, status: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                {/* Commencement Date */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Commencement Date</label>
                  <input
                    type="date"
                    value={contractForm.commencement_date}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, commencement_date: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Expiration Date */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Expiration Date</label>
                  <input
                    type="date"
                    value={contractForm.expiration_date}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, expiration_date: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Laytime Allowed Hours */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Laytime Permitted (Hours)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={contractForm.laytime_allowed_hours}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, laytime_allowed_hours: e.target.value })
                    }
                    placeholder="e.g. 72"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Demurrage Daily Rate */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Demurrage Daily Rate ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={contractForm.demurrage_rate_daily}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, demurrage_rate_daily: e.target.value })
                    }
                    placeholder="e.g. 15000"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Despatch Daily Rate */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold text-slate-700 block">Despatch Daily Rate ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={contractForm.despatch_rate_daily}
                    onChange={(e) =>
                      setContractForm({ ...contractForm, despatch_rate_daily: e.target.value })
                    }
                    placeholder="e.g. 7500"
                    className="w-full sm:w-1/2 rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <p className="text-[10px] text-slate-400">Early departure incentive rate per day</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setEditModalOpen(false);
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
                  className="text-xs gap-1.5 shadow-xs"
                >
                  {isSubmitting && <SpinnerIcon size={14} className="animate-spin" />}
                  <span>{editModalOpen ? "Save Changes" : "Create Contract"}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: Contract Detail & Clause Repository Workspace ─── */}
      {detailModalOpen && selectedContract && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contract-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div
            className="w-full max-w-4xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-4 sm:my-8 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/75 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-brand-50 text-brand-700 shrink-0">
                  <ContractsIcon size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 id="contract-detail-title" className="text-base font-bold text-slate-900 font-mono">
                      {selectedContract.contract_reference}
                    </h3>
                    <ContractStatusBadge status={selectedContract.status} />
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{selectedContract.contract_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canMutate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDetailModalOpen(false);
                      handleOpenEditModal(selectedContract);
                    }}
                    className="text-xs gap-1 hidden sm:inline-flex"
                  >
                    <EditIcon size={12} />
                    <span>Edit Terms</span>
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                  aria-label="Close modal"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Contract Metadata Overview Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Counterparties */}
                <Card className="p-3.5 space-y-1.5 shadow-2xs border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Parties &amp; Intermediaries
                  </span>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-slate-400">Charterer: </span>
                      <span className="font-semibold text-slate-800">{selectedContract.charterer || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Vessel Owner: </span>
                      <span className="font-semibold text-slate-800">{selectedContract.owner || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Broker: </span>
                      <span className="font-semibold text-slate-800">{selectedContract.broker || "—"}</span>
                    </div>
                  </div>
                </Card>

                {/* Fleet Asset & Document */}
                <Card className="p-3.5 space-y-1.5 shadow-2xs border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Linked Assets
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      <VesselsIcon size={14} className="text-slate-400 shrink-0" />
                      {selectedContract.vessel_id && vesselsMap.get(selectedContract.vessel_id) ? (
                        <span className="font-semibold text-slate-800">
                          {vesselsMap.get(selectedContract.vessel_id)?.name} (
                          {vesselsMap.get(selectedContract.vessel_id)?.imo_number})
                        </span>
                      ) : (
                        <span className="text-slate-400">No Fleet Vessel</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DocumentsIcon size={14} className="text-slate-400 shrink-0" />
                      {selectedContract.document_id && documentsMap.get(selectedContract.document_id) ? (
                        <span className="font-semibold text-slate-800 truncate" title={documentsMap.get(selectedContract.document_id)?.title}>
                          {documentsMap.get(selectedContract.document_id)?.title}
                        </span>
                      ) : (
                        <span className="text-slate-400">No Source Document</span>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Commercial Terms */}
                <Card className="p-3.5 space-y-1.5 shadow-2xs border-slate-200 bg-slate-50/50">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Laytime &amp; Rate Terms
                  </span>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-slate-400">Laytime: </span>
                      <span className="font-semibold text-slate-800">{formatHours(selectedContract.laytime_allowed_hours)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Demurrage: </span>
                      <span className="font-semibold text-amber-700">{formatCurrency(selectedContract.demurrage_rate_daily)}/day</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Despatch: </span>
                      <span className="font-semibold text-emerald-700">{formatCurrency(selectedContract.despatch_rate_daily)}/day</span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Term Dates Notice */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Contract Period:</span>
                  <span>
                    {formatDate(selectedContract.commencement_date)} to {formatDate(selectedContract.expiration_date)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Created {formatDate(selectedContract.created_at)}
                </div>
              </div>

              {/* ─── Structured Clauses Section ─── */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      Contract Clauses &amp; Rider Provisions
                    </h4>
                    <Badge variant="outline" size="sm">
                      {selectedContract.clauses?.length || 0} Clauses
                    </Badge>
                  </div>
                  {canMutate && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleOpenCreateClauseModal}
                      className="gap-1.5 text-xs shadow-xs"
                    >
                      <PlusIcon size={14} />
                      <span>Add Clause</span>
                    </Button>
                  )}
                </div>

                {/* Clauses Listing */}
                {!selectedContract.clauses || selectedContract.clauses.length === 0 ? (
                  <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
                    <p className="text-xs text-slate-500 font-medium">
                      No clauses have been recorded for this contract.
                    </p>
                    {canMutate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenCreateClauseModal}
                        className="text-xs gap-1.5"
                      >
                        <PlusIcon size={14} />
                        <span>Add First Clause</span>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedContract.clauses
                      .slice()
                      .sort((a, b) => a.order_index - b.order_index)
                      .map((clause, idx) => (
                        <div
                          key={clause.id}
                          className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors shadow-2xs space-y-2.5"
                        >
                          {/* Clause Header Bar */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                                Cl. {clause.clause_number}
                              </span>
                              <Badge variant="secondary" size="sm">
                                {clause.clause_type}
                              </Badge>
                              {clause.clause_title && (
                                <span className="text-xs font-semibold text-slate-900">
                                  {clause.clause_title}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-slate-400 font-mono pr-2">
                                #{idx + 1}
                              </span>
                              {canMutate && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEditClauseModal(clause)}
                                  className="h-6 w-6 p-0 text-slate-500 hover:text-slate-800"
                                  title="Edit clause"
                                >
                                  <EditIcon size={12} />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenDeleteClauseModal(clause)}
                                  className="h-6 w-6 p-0 text-rose-500 hover:text-rose-700"
                                  title="Delete clause"
                                >
                                  <TrashIcon size={12} />
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Verbatim Clause Text */}
                          <div className="text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap break-words bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                            {clause.clause_text}
                          </div>

                          {/* Traceability Metadata */}
                          {clause.document_chunk_id && (
                            <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                              <DocumentsIcon size={10} />
                              <span>Source Chunk: {clause.document_chunk_id}</span>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-slate-50/50 shrink-0">
              <div className="text-xs text-slate-400">
                Contract ID: <span className="font-mono">{selectedContract.id}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailModalOpen(false)}
                className="text-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: Create / Edit Clause ─── */}
      {clauseModalOpen && selectedContract && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clause-modal-title"
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div
            className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50">
              <h3 id="clause-modal-title" className="text-base font-semibold text-slate-900">
                {editingClause ? "Edit Clause" : "Add Contract Clause"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setClauseModalOpen(false);
                  setEditingClause(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveClause} className="p-6 space-y-4">
              {clauseError && (
                <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-800 border border-rose-200">
                  {clauseError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Clause Number */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Clause Number/Ref <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={clauseForm.clause_number}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, clause_number: e.target.value })
                    }
                    placeholder="e.g. 1, 2.1, Cl-14"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Clause Classification Type */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Clause Classification <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    list="clause-types"
                    value={clauseForm.clause_type}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, clause_type: e.target.value })
                    }
                    placeholder="e.g. Laytime"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <datalist id="clause-types">
                    {COMMON_CLAUSE_TYPES.map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </div>

                {/* Clause Title */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold text-slate-700 block">
                    Clause Title / Header
                  </label>
                  <input
                    type="text"
                    maxLength={255}
                    value={clauseForm.clause_title}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, clause_title: e.target.value })
                    }
                    placeholder="e.g. Total Permitted Laytime &amp; Reversible SHINC Terms"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Order Index */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Order Index</label>
                  <input
                    type="number"
                    min="0"
                    value={clauseForm.order_index}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, order_index: Number(e.target.value) })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Optional Chunk UUID */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Document Chunk ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={clauseForm.document_chunk_id}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, document_chunk_id: e.target.value })
                    }
                    placeholder="UUID or leave blank"
                    className="w-full font-mono text-[11px] rounded-md border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Clause Text */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold text-slate-700 block">
                    Verbatim Clause Content <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={clauseForm.clause_text}
                    onChange={(e) =>
                      setClauseForm({ ...clauseForm, clause_text: e.target.value })
                    }
                    placeholder="Enter verbatim contractual terms as agreed in the charter party..."
                    className="w-full rounded-md border border-slate-300 p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 leading-relaxed font-sans"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setClauseModalOpen(false);
                    setEditingClause(null);
                  }}
                  disabled={clauseSubmitting}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={clauseSubmitting}
                  className="text-xs gap-1.5 shadow-xs"
                >
                  {clauseSubmitting && <SpinnerIcon size={14} className="animate-spin" />}
                  <span>{editingClause ? "Update Clause" : "Add Clause"}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 4: Delete Contract Confirmation ─── */}
      {deleteModalOpen && contractToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-contract-modal-title"
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div
            className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-rose-50 text-rose-600">
                  <TrashIcon size={20} />
                </div>
                <h3 id="delete-contract-modal-title" className="text-base font-semibold text-slate-900">
                  Delete Commercial Contract
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to permanently delete contract{" "}
                <span className="font-mono font-semibold text-slate-900">
                  {contractToDelete.contract_reference}
                </span>
                ? All associated contractual clauses will be removed. Referenced fleet vessels and source documents will remain intact.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 bg-slate-50 border-t border-slate-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setContractToDelete(null);
                }}
                disabled={isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDeleteContract}
                disabled={isSubmitting}
                className="text-xs gap-1.5 shadow-xs"
              >
                {isSubmitting && <SpinnerIcon size={14} className="animate-spin" />}
                <span>Delete Contract</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 5: Delete Clause Confirmation ─── */}
      {deleteClauseModalOpen && clauseToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-clause-modal-title"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div
            className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-rose-50 text-rose-600">
                  <TrashIcon size={20} />
                </div>
                <h3 id="delete-clause-modal-title" className="text-base font-semibold text-slate-900">
                  Delete Contract Clause
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to delete clause{" "}
                <span className="font-mono font-semibold text-slate-900">
                  {clauseToDelete.clause_number}
                </span>{" "}
                ({clauseToDelete.clause_type})? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 bg-slate-50 border-t border-slate-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeleteClauseModalOpen(false);
                  setClauseToDelete(null);
                }}
                disabled={clauseSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDeleteClause}
                disabled={clauseSubmitting}
                className="text-xs gap-1.5 shadow-xs"
              >
                {clauseSubmitting && <SpinnerIcon size={14} className="animate-spin" />}
                <span>Delete Clause</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
