"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listDocuments,
  getDocument,
  uploadDocument,
  getDocumentDownloadUrl,
  deleteDocument,
  ingestDocument,
  DocumentListItem,
  DocumentRead,
} from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  DocumentsIcon,
  UploadIcon,
  DownloadIcon,
  TrashIcon,
  EyeIcon,
  RefreshIcon,
  SpinnerIcon,
  CloseIcon,
} from "@/components/icons";

const DOCUMENT_TYPES = [
  { value: "", label: "All Document Types" },
  { value: "CHARTER_PARTY", label: "Charter Party" },
  { value: "STATEMENT_OF_FACTS", label: "Statement of Facts" },
  { value: "NOR", label: "Notice of Readiness" },
  { value: "INVOICE", label: "Invoice" },
  { value: "OTHER", label: "Other" },
];

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

function StatusBadge({ status }: { status: string }) {
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

export default function DocumentsPage() {
  const { backendUser } = useAuth();
  const filterSelectId = useId();
  const uploadTypeId = useId();
  const isAuthorizedToDelete =
    backendUser?.role === "admin" || backendUser?.role === "manager";

  // Document List State
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedType, setSelectedType] = useState<string>("");

  // Feedback Notification
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Upload Modal State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState("CHARTER_PARTY");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Details Modal State
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<DocumentRead | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete Confirmation Modal State
  const [documentToDelete, setDocumentToDelete] =
    useState<DocumentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Action Loading States
  const [actionDocId, setActionDocId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"download" | "ingest" | null>(
    null
  );

  // Lock body scroll when any dialog is open
  const isAnyModalOpen = Boolean(isUploadOpen || selectedDocId || documentToDelete);
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

  // Handle Escape key to dismiss active dialog safely
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (documentToDelete && !isDeleting) {
          setDocumentToDelete(null);
        } else if (selectedDocId && !isLoadingDetail) {
          setSelectedDocId(null);
          setDetailDoc(null);
        } else if (isUploadOpen && !isUploading) {
          setIsUploadOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [documentToDelete, isDeleting, selectedDocId, isLoadingDetail, isUploadOpen, isUploading]);

  // Manual refresh function
  const refreshDocuments = useCallback(
    async (currentPage = page, typeFilter = selectedType) => {
      try {
        setLoading(true);
        setError(null);
        const res = await listDocuments({
          page: currentPage,
          page_size: pageSize,
          document_type: typeFilter || undefined,
        });
        setDocuments(res.items);
        setTotalItems(res.total);
        setTotalPages(res.total_pages || 1);
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, "Unable to load your documents. Please check your network and try again."));
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, selectedType]
  );

  // Synchronize document list on page or filter change
  useEffect(() => {
    let ignore = false;

    listDocuments({
      page,
      page_size: pageSize,
      document_type: selectedType || undefined,
    })
      .then((res) => {
        if (!ignore) {
          setDocuments(res.items);
          setTotalItems(res.total);
          setTotalPages(res.total_pages || 1);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(getApiErrorMessage(err, "Unable to load your documents. Please check your network and try again."));
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
  }, [page, pageSize, selectedType]);

  // Load Document Details
  const handleOpenDetails = async (id: string) => {
    setSelectedDocId(id);
    setIsLoadingDetail(true);
    try {
      const doc = await getDocument(id);
      setDetailDoc(doc);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to load document details."),
      });
      setSelectedDocId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Download Handler
  const handleDownload = async (id: string, fallbackTitle: string) => {
    try {
      setActionDocId(id);
      setActionType("download");
      const res = await getDocumentDownloadUrl(id);
      if (res.download_url) {
        window.open(res.download_url, "_blank", "noopener,noreferrer");
      } else {
        setFeedback({
          type: "error",
          message: "Unable to download this document. Download URL not returned.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, `Unable to download ${fallbackTitle}.`),
      });
    } finally {
      setActionDocId(null);
      setActionType(null);
    }
  };

  // Ingestion Handler
  const handleIngest = async (id: string) => {
    try {
      setActionDocId(id);
      setActionType("ingest");
      const res = await ingestDocument(id);
      // Update the document status in state based strictly on real backend response
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: res.status } : d))
      );
      if (detailDoc && detailDoc.id === id) {
        setDetailDoc({ ...detailDoc, status: res.status });
      }
      setFeedback({
        type: "success",
        message: `Document processing completed. Status: ${res.status}${
          res.chunk_count ? ` (${res.chunk_count} chunks indexed)` : ""
        }.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to process this document."),
      });
    } finally {
      setActionDocId(null);
      setActionType(null);
    }
  };

  // Delete Handler
  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;
    try {
      setIsDeleting(true);
      await deleteDocument(documentToDelete.id);
      setDocuments((prev) => prev.filter((d) => d.id !== documentToDelete.id));
      setTotalItems((prev) => Math.max(0, prev - 1));
      if (selectedDocId === documentToDelete.id) {
        setSelectedDocId(null);
        setDetailDoc(null);
      }
      setDocumentToDelete(null);
      setFeedback({
        type: "success",
        message: "Document deleted successfully.",
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: getApiErrorMessage(err, "Unable to delete this document."),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Upload Form Submission
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || isUploading) return;

    // Client-side file validation
    if (!uploadFile.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF documents are supported (.pdf).");
      return;
    }
    const maxSizeBytes = 50 * 1024 * 1024; // 50MB
    if (uploadFile.size > maxSizeBytes) {
      setUploadError("File exceeds the maximum size limit of 50MB.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);

      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("document_type", uploadDocType);
      if (uploadDescription.trim()) {
        formData.append("description", uploadDescription.trim());
      }

      const newDoc = await uploadDocument(formData);
      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadDescription("");
      setFeedback({
        type: "success",
        message: `Document "${newDoc.title}" uploaded successfully.`,
      });
      // Refresh to top of list
      setPage(1);
      refreshDocuments(1, selectedType);
    } catch (err: unknown) {
      setUploadError(getApiErrorMessage(err, "Unable to upload this document."));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Manage maritime documents used across your workspace."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Documents" },
        ]}
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setUploadError(null);
              setIsUploadOpen(true);
            }}
            className="gap-2 shrink-0"
          >
            <UploadIcon size={16} />
            <span>Upload document</span>
          </Button>
        }
      />

      {/* Global Notice / Feedback banner */}
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
            aria-label="Dismiss message"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* Filter and Control Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-xs">
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <label htmlFor={filterSelectId} className="text-xs font-medium text-slate-500 shrink-0">
            Type:
          </label>
          <select
            id={filterSelectId}
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by document type"
            className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer w-full sm:w-48"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <span className="text-xs text-slate-500 font-medium">
            {totalItems} {totalItems === 1 ? "document" : "documents"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshDocuments(page, selectedType)}
            disabled={loading}
            title="Refresh document list"
            aria-label="Refresh document list"
            className="gap-1.5 h-8 text-xs"
          >
            <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <Card className="p-8 text-center border-red-200 bg-red-50/50">
          <p className="text-sm font-medium text-red-700 mb-4">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshDocuments(page, selectedType)}
          >
            Retry
          </Button>
        </Card>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          <div className="p-4 bg-slate-50/70 animate-pulse flex items-center justify-between">
            <div className="h-4 w-32 bg-slate-200 rounded" />
            <div className="h-4 w-20 bg-slate-200 rounded" />
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 flex items-center justify-between animate-pulse">
              <div className="space-y-2">
                <div className="h-4 w-48 sm:w-72 bg-slate-200 rounded" />
                <div className="h-3 w-28 bg-slate-100 rounded" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-6 w-16 bg-slate-200 rounded-full" />
                <div className="h-8 w-8 bg-slate-100 rounded-lg hidden sm:block" />
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && documents.length === 0 && (
        <EmptyState
          icon={<DocumentsIcon size={24} />}
          badgeText="Document Repository"
          title={selectedType ? "No Matching Documents" : "No Documents Yet"}
          description={
            selectedType
              ? "No documents match the selected filter. Try clearing the filter or uploading a new file."
              : "Upload a PDF to start building your maritime document workspace."
          }
          action={
            selectedType ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedType("");
                  setPage(1);
                }}
              >
                Clear filter
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setUploadError(null);
                  setIsUploadOpen(true);
                }}
                className="gap-1.5"
              >
                <UploadIcon size={14} />
                <span>Upload document</span>
              </Button>
            )
          }
        />
      )}

      {/* Document List Table / Cards */}
      {!loading && !error && documents.length > 0 && (
        <Card className="overflow-hidden shadow-xs">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="py-3.5 pl-5 pr-3">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Size
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Uploaded
                  </th>
                  <th scope="col" className="py-3.5 pl-3 pr-5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => {
                  const isIngestingThis =
                    actionDocId === doc.id && actionType === "ingest";
                  const isDownloadingThis =
                    actionDocId === doc.id && actionType === "download";

                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-4 pl-5 pr-3 font-medium text-slate-900 max-w-xs">
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(doc.id)}
                          className="text-left font-semibold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer truncate block w-full"
                          title={doc.title}
                        >
                          {doc.title}
                        </button>
                      </td>
                      <td className="px-3 py-4 text-slate-600 text-xs whitespace-nowrap">
                        {formatDocType(doc.document_type)}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="px-3 py-4 text-slate-500 text-xs whitespace-nowrap">
                        {formatFileSize(doc.file_size_bytes)}
                      </td>
                      <td className="px-3 py-4 text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(doc.created_at)}
                      </td>
                      <td className="py-4 pl-3 pr-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Ingest action if not already ready */}
                          {doc.status !== "ready" && (
                            <button
                              type="button"
                              onClick={() => handleIngest(doc.id)}
                              disabled={isIngestingThis}
                              title="Process document into vector index"
                              aria-label="Process document"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isIngestingThis ? (
                                <SpinnerIcon size={13} />
                              ) : (
                                <RefreshIcon size={13} />
                              )}
                              <span>Process</span>
                            </button>
                          )}

                          {/* View details */}
                          <button
                            type="button"
                            onClick={() => handleOpenDetails(doc.id)}
                            title="View document details"
                            aria-label="View document details"
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                          >
                            <EyeIcon size={16} />
                          </button>

                          {/* Download */}
                          <button
                            type="button"
                            onClick={() => handleDownload(doc.id, doc.title)}
                            disabled={isDownloadingThis}
                            title="Download document from cloud storage"
                            aria-label="Download document"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {isDownloadingThis ? (
                              <SpinnerIcon size={16} />
                            ) : (
                              <DownloadIcon size={16} />
                            )}
                          </button>

                          {/* Delete (RBAC: Admin or Manager) */}
                          {isAuthorizedToDelete && (
                            <button
                              type="button"
                              onClick={() => setDocumentToDelete(doc)}
                              title="Delete document"
                              aria-label="Delete document"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            >
                              <TrashIcon size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View */}
          <div className="md:hidden divide-y divide-slate-100">
            {documents.map((doc) => {
              const isIngestingThis =
                actionDocId === doc.id && actionType === "ingest";
              const isDownloadingThis =
                actionDocId === doc.id && actionType === "download";

              return (
                <div key={doc.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenDetails(doc.id)}
                      className="text-left font-semibold text-slate-900 hover:text-blue-600 text-sm leading-snug break-words"
                    >
                      {doc.title}
                    </button>
                    <StatusBadge status={doc.status} />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{formatDocType(doc.document_type)}</span>
                    <span>•</span>
                    <span>{formatFileSize(doc.file_size_bytes)}</span>
                    <span>•</span>
                    <span>{formatDate(doc.created_at)}</span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-50">
                    {doc.status !== "ready" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleIngest(doc.id)}
                        disabled={isIngestingThis}
                        className="gap-1 text-xs"
                      >
                        {isIngestingThis ? (
                          <SpinnerIcon size={12} />
                        ) : (
                          <RefreshIcon size={12} />
                        )}
                        <span>Process</span>
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDetails(doc.id)}
                      className="gap-1 text-xs"
                    >
                      <EyeIcon size={14} />
                      <span>Details</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(doc.id, doc.title)}
                      disabled={isDownloadingThis}
                      className="gap-1 text-xs"
                    >
                      {isDownloadingThis ? (
                        <SpinnerIcon size={14} />
                      ) : (
                        <DownloadIcon size={14} />
                      )}
                      <span>Download</span>
                    </Button>

                    {isAuthorizedToDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDocumentToDelete(doc)}
                        className="text-red-600 hover:bg-red-50 text-xs px-2"
                        aria-label="Delete document"
                      >
                        <TrashIcon size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Bar */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 bg-slate-50/50 text-xs">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                Previous
              </Button>
              <span className="text-slate-600 font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* ─── Upload Modal ─────────────────────────────────────────────────── */}
      {isUploadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isUploading) {
              setIsUploadOpen(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-4 sm:p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2
                id="upload-modal-title"
                className="text-lg font-bold text-slate-900"
              >
                Upload Maritime Document
              </h2>
              <button
                type="button"
                onClick={() => !isUploading && setIsUploadOpen(false)}
                disabled={isUploading}
                aria-label="Close upload dialog"
                className="text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {uploadError && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200 font-medium"
              >
                {uploadError}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* File Input */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700 tracking-wide uppercase">
                  PDF File
                </span>
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-6 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <input
                    type="file"
                    id="doc-file-input"
                    accept=".pdf,application/pdf"
                    required
                    disabled={isUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setUploadFile(file);
                      setUploadError(null);
                    }}
                    className="hidden"
                  />
                  <label
                    htmlFor="doc-file-input"
                    className="flex flex-col items-center cursor-pointer text-center"
                  >
                    <UploadIcon size={28} className="text-slate-400 mb-2" />
                    <span className="text-xs font-semibold text-blue-600 hover:underline">
                      {uploadFile ? "Change file" : "Select PDF from computer"}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1">
                      PDF documents up to 50MB
                    </span>
                  </label>
                  {uploadFile && (
                    <div className="mt-3 text-xs font-medium text-slate-800 bg-white px-3 py-1 rounded border border-slate-200">
                      {uploadFile.name} ({formatFileSize(uploadFile.size)})
                    </div>
                  )}
                </div>
              </div>

              {/* Document Type */}
              <div className="space-y-1.5">
                <label
                  htmlFor={uploadTypeId}
                  className="block text-xs font-semibold text-slate-700 tracking-wide uppercase"
                >
                  Document Classification
                </label>
                <select
                  id={uploadTypeId}
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value)}
                  disabled={isUploading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="CHARTER_PARTY">Charter Party</option>
                  <option value="STATEMENT_OF_FACTS">Statement of Facts</option>
                  <option value="NOR">Notice of Readiness</option>
                  <option value="INVOICE">Invoice</option>
                  <option value="OTHER">Other Document</option>
                </select>
              </div>

              {/* Description */}
              <Input
                label="Description (Optional)"
                type="text"
                placeholder="e.g. M/V Pacific Trader Voyage 42 Charter Agreement"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                disabled={isUploading}
              />

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={!uploadFile || isUploading}
                  className="gap-2"
                >
                  {isUploading ? (
                    <>
                      <SpinnerIcon size={16} />
                      <span>Uploading to Cloud Storage...</span>
                    </>
                  ) : (
                    <span>Upload Document</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Details Modal ─────────────────────────────────────────────────── */}
      {selectedDocId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedDocId(null);
              setDetailDoc(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-xl rounded-xl bg-white p-4 sm:p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2
                id="details-modal-title"
                className="text-lg font-bold text-slate-900 truncate pr-4"
              >
                {detailDoc?.title || "Document Details"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedDocId(null);
                  setDetailDoc(null);
                }}
                aria-label="Close details dialog"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {isLoadingDetail ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <SpinnerIcon size={24} className="text-blue-600" />
                <p className="text-xs text-slate-500">Loading document details...</p>
              </div>
            ) : detailDoc ? (
              <div className="space-y-4 text-xs">
                {/* Status and Type Grid */}
                <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div>
                    <span className="text-slate-400 block mb-1">Status</span>
                    <StatusBadge status={detailDoc.status} />
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Type</span>
                    <span className="font-semibold text-slate-800">
                      {formatDocType(detailDoc.document_type)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">File Format</span>
                    <span className="font-semibold text-slate-800 uppercase">
                      {detailDoc.file_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Uploaded Date</span>
                    <span className="font-semibold text-slate-800">
                      {formatDate(detailDoc.created_at)}
                    </span>
                  </div>
                </div>

                {/* Storage and System Info */}
                <div className="space-y-2">
                  <span className="font-semibold text-slate-800 block">
                    Cloud Storage & Identity
                  </span>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1.5 font-mono text-[11px] text-slate-600 break-all">
                    <div>
                      <span className="text-slate-400">ID: </span>
                      {detailDoc.id}
                    </div>
                    <div>
                      <span className="text-slate-400">GCS URI: </span>
                      {detailDoc.gcs_uri}
                    </div>
                  </div>
                </div>

                {/* Error message if status is failed */}
                {detailDoc.error_message && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
                    <span className="font-semibold block mb-0.5">Ingestion Notice:</span>
                    <span>{detailDoc.error_message}</span>
                  </div>
                )}

                {/* Version History */}
                {detailDoc.versions && detailDoc.versions.length > 0 && (
                  <div className="space-y-2">
                    <span className="font-semibold text-slate-800 block">
                      Version Revisions ({detailDoc.versions.length})
                    </span>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                      {detailDoc.versions.map((v) => (
                        <div
                          key={v.id}
                          className="p-2.5 flex items-center justify-between text-slate-600 bg-white text-xs"
                        >
                          <span className="font-semibold text-slate-800">
                            Version {v.version_number}
                          </span>
                          <span>{formatFileSize(v.file_size_bytes)}</span>
                          <span className="text-slate-400">
                            {formatDate(v.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                  {detailDoc.status !== "ready" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleIngest(detailDoc.id)}
                      disabled={actionDocId === detailDoc.id}
                      className="gap-1.5"
                    >
                      {actionDocId === detailDoc.id ? (
                        <SpinnerIcon size={14} />
                      ) : (
                        <RefreshIcon size={14} />
                      )}
                      <span>Process Vector Index</span>
                    </Button>
                  )}

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleDownload(detailDoc.id, detailDoc.title)}
                    disabled={actionDocId === detailDoc.id}
                    className="gap-1.5"
                  >
                    <DownloadIcon size={14} />
                    <span>Download File</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ────────────────────────────────────── */}
      {documentToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setDocumentToDelete(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-4 sm:p-6 shadow-xl border border-slate-200 space-y-4">
            <h2
              id="delete-dialog-title"
              className="text-base font-bold text-slate-900"
            >
              Delete document?
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently remove{" "}
              <strong className="text-slate-900 font-semibold">
                &ldquo;{documentToDelete.title}&rdquo;
              </strong>{" "}
              from Maritime Nexus and delete its storage object from Google Cloud Storage.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDocumentToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <SpinnerIcon size={14} />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete document</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
