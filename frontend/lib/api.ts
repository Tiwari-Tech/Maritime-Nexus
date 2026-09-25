import axios, { AxiosInstance } from "axios";
import { auth } from "@/lib/firebase";

export interface BackendUserProfile {
  id: string;
  firebase_uid: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  organization_id: string | null;
  created_at: string | null;
}

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// Request interceptor: attach fresh Firebase ID token if user is signed in
api.interceptors.request.use(
  async (config) => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } catch (err) {
        console.error("Failed to acquire Firebase ID token for API request:", err);
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Synchronize and fetch authenticated backend user profile from FastAPI backend.
 * Endpoint: GET /api/v1/auth/me
 */
export async function getBackendCurrentUser(): Promise<BackendUserProfile> {
  const res = await api.get<BackendUserProfile>("/api/v1/auth/me");
  return res.data;
}

export interface CreateOrganizationPayload {
  name: string;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string | null;
}

/**
 * Create and onboard into a new organization.
 * Endpoint: POST /api/v1/organizations
 */
export async function createOrganization(
  payload: CreateOrganizationPayload
): Promise<OrganizationResponse> {
  const res = await api.post<OrganizationResponse>("/api/v1/organizations", payload);
  return res.data;
}

// ─── Document Management Types & API ─────────────────────────────────────────

export interface DocumentVersionRead {
  id: string;
  document_id: string;
  version_number: number;
  gcs_uri: string;
  file_size_bytes: number | null;
  file_hash: string | null;
  created_at: string;
}

export interface DocumentRead {
  id: string;
  organization_id: string | null;
  uploader_id: string | null;
  vessel_id: string | null;
  voyage_id: string | null;
  title: string;
  document_type: string;
  file_type: string;
  gcs_uri: string;
  status: string;
  error_message: string | null;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  versions: DocumentVersionRead[];
}

export interface DocumentListItem {
  id: string;
  organization_id: string | null;
  title: string;
  document_type: string;
  file_type: string;
  status: string;
  vessel_id: string | null;
  voyage_id: string | null;
  created_at: string;
  file_size_bytes: number | null;
}

export interface DocumentListResponse {
  items: DocumentListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DocumentDownloadResponse {
  document_id: string;
  filename: string;
  download_url: string;
  expires_in_seconds: number;
}

export interface DocumentDeleteResponse {
  message: string;
  document_id: string;
}

export interface IngestionResponse {
  document_id: string;
  status: string;
  chunk_count: number;
}

export interface ListDocumentsParams {
  page?: number;
  page_size?: number;
  document_type?: string;
  vessel_id?: string;
  voyage_id?: string;
}

/**
 * List documents for the authenticated organization with pagination.
 * Endpoint: GET /api/v1/documents
 */
export async function listDocuments(
  params?: ListDocumentsParams
): Promise<DocumentListResponse> {
  const res = await api.get<DocumentListResponse>("/api/v1/documents", { params });
  return res.data;
}

/**
 * Retrieve full metadata for a specific document.
 * Endpoint: GET /api/v1/documents/{id}
 */
export async function getDocument(documentId: string): Promise<DocumentRead> {
  const res = await api.get<DocumentRead>(`/api/v1/documents/${documentId}`);
  return res.data;
}

/**
 * Upload a PDF document using multipart/form-data.
 * Endpoint: POST /api/v1/documents
 */
export async function uploadDocument(formData: FormData): Promise<DocumentRead> {
  const res = await api.post<DocumentRead>("/api/v1/documents", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
}

/**
 * Generate a short-lived signed GCS download URL for a document.
 * Endpoint: GET /api/v1/documents/{id}/download
 */
export async function getDocumentDownloadUrl(
  documentId: string
): Promise<DocumentDownloadResponse> {
  const res = await api.get<DocumentDownloadResponse>(
    `/api/v1/documents/${documentId}/download`
  );
  return res.data;
}

/**
 * Delete a document and its storage object (Admin or Manager).
 * Endpoint: DELETE /api/v1/documents/{id}
 */
export async function deleteDocument(
  documentId: string
): Promise<DocumentDeleteResponse> {
  const res = await api.delete<DocumentDeleteResponse>(
    `/api/v1/documents/${documentId}`
  );
  return res.data;
}

/**
 * Trigger RAG vector index ingestion for a document.
 * Endpoint: POST /api/v1/documents/{id}/ingest
 */
export async function ingestDocument(
  documentId: string
): Promise<IngestionResponse> {
  const res = await api.post<IngestionResponse>(
    `/api/v1/documents/${documentId}/ingest`
  );
  return res.data;
}

// ─── RAG Q&A Types & API ─────────────────────────────────────────────────────

export interface RAGSourceReference {
  document_id: string;
  chunk_id: string;
  document_title: string;
  page_number: number | null;
  score: number;
}

export interface RAGAskRequest {
  query: string;
  top_k?: number | null;
  document_id?: string | null;
}

export interface RAGAskResponse {
  answer: string;
  sources: RAGSourceReference[];
}

/**
 * Ask a grounded question over indexed organization documents.
 * Endpoint: POST /api/v1/rag/ask
 * Note: Configured with 120s timeout matching backend OLLAMA_LLM_TIMEOUT_SECONDS.
 */
export async function askRag(payload: RAGAskRequest): Promise<RAGAskResponse> {
  const res = await api.post<RAGAskResponse>("/api/v1/rag/ask", payload, {
    timeout: 120000,
  });
  return res.data;
}

// ─── Vessel Management Types & API ──────────────────────────────────────────

export interface VesselCreatePayload {
  imo_number: string;
  name: string;
  vessel_type: string;
  flag?: string | null;
  call_sign?: string | null;
  mmsi?: string | null;
  deadweight_tonnage?: number | null;
  gross_tonnage?: number | null;
  year_built?: number | null;
  status?: string;
}

export interface VesselUpdatePayload {
  imo_number?: string | null;
  name?: string | null;
  vessel_type?: string | null;
  flag?: string | null;
  call_sign?: string | null;
  mmsi?: string | null;
  deadweight_tonnage?: number | null;
  gross_tonnage?: number | null;
  year_built?: number | null;
  status?: string | null;
}

export interface VesselListItem {
  id: string;
  organization_id: string | null;
  imo_number: string;
  name: string;
  vessel_type: string;
  flag: string | null;
  call_sign: string | null;
  mmsi: string | null;
  deadweight_tonnage: number | null;
  gross_tonnage: number | null;
  year_built: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VesselRead {
  id: string;
  organization_id: string | null;
  imo_number: string;
  name: string;
  vessel_type: string;
  flag: string | null;
  call_sign: string | null;
  mmsi: string | null;
  deadweight_tonnage: number | null;
  gross_tonnage: number | null;
  year_built: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type Vessel = VesselRead;

export interface VesselListResponse {
  items: VesselListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface VesselDeleteResponse {
  message: string;
  vessel_id: string;
}

export interface ListVesselsParams {
  page?: number;
  page_size?: number;
  status?: string;
  vessel_type?: string;
  flag?: string;
  imo_number?: string;
  search?: string;
}

/**
 * List vessels strictly scoped to the authenticated user's organization.
 * Endpoint: GET /api/v1/vessels
 */
export async function listVessels(params?: ListVesselsParams): Promise<VesselListResponse> {
  const res = await api.get<VesselListResponse>("/api/v1/vessels", { params });
  return res.data;
}

/**
 * Retrieve full details of a single vessel within the user's organization.
 * Endpoint: GET /api/v1/vessels/{id}
 */
export async function getVessel(vesselId: string): Promise<VesselRead> {
  const res = await api.get<VesselRead>(`/api/v1/vessels/${vesselId}`);
  return res.data;
}

/**
 * Register a new vessel under the authenticated user's organization (Operator+).
 * Endpoint: POST /api/v1/vessels
 */
export async function createVessel(payload: VesselCreatePayload): Promise<VesselRead> {
  const res = await api.post<VesselRead>("/api/v1/vessels", payload);
  return res.data;
}

/**
 * Partially update vessel particulars (Operator+).
 * Endpoint: PATCH /api/v1/vessels/{id}
 */
export async function updateVessel(vesselId: string, payload: VesselUpdatePayload): Promise<VesselRead> {
  const res = await api.patch<VesselRead>(`/api/v1/vessels/${vesselId}`, payload);
  return res.data;
}

/**
 * Delete a vessel (Admin and Manager only).
 * Endpoint: DELETE /api/v1/vessels/{id}
 */
export async function deleteVessel(vesselId: string): Promise<VesselDeleteResponse> {
  const res = await api.delete<VesselDeleteResponse>(`/api/v1/vessels/${vesselId}`);
  return res.data;
}

// ─── Voyage & VoyageEvent Types & API ────────────────────────────────────────

export interface VoyageEventCreatePayload {
  port_id?: string | null;
  event_type: string;
  timestamp: string;
  end_timestamp?: string | null;
  description?: string | null;
  is_delay?: boolean;
  delay_reason?: string | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface VoyageEventRead {
  id: string;
  voyage_id: string;
  port_id: string | null;
  event_type: string;
  timestamp: string;
  end_timestamp: string | null;
  description: string | null;
  is_delay: boolean;
  delay_reason: string | null;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type VoyageEvent = VoyageEventRead;

export interface VoyageEventListResponse {
  items: VoyageEventRead[];
  total: number;
}

export interface VoyageCreatePayload {
  vessel_id: string;
  voyage_number: string;
  origin_port_id?: string | null;
  destination_port_id?: string | null;
  departure_date?: string | null;
  arrival_date?: string | null;
  status?: string;
  cargo_type?: string | null;
  cargo_quantity?: number | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface VoyageUpdatePayload {
  vessel_id?: string;
  voyage_number?: string;
  origin_port_id?: string | null;
  destination_port_id?: string | null;
  departure_date?: string | null;
  arrival_date?: string | null;
  status?: string | null;
  cargo_type?: string | null;
  cargo_quantity?: number | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface VoyageListItem {
  id: string;
  vessel_id: string;
  voyage_number: string;
  origin_port_id: string | null;
  destination_port_id: string | null;
  departure_date: string | null;
  arrival_date: string | null;
  status: string;
  cargo_type: string | null;
  cargo_quantity: number | null;
  created_at: string;
  updated_at: string;
}

export interface VoyageRead {
  id: string;
  vessel_id: string;
  voyage_number: string;
  origin_port_id: string | null;
  destination_port_id: string | null;
  departure_date: string | null;
  arrival_date: string | null;
  status: string;
  cargo_type: string | null;
  cargo_quantity: number | null;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  events: VoyageEventRead[];
}

export type Voyage = VoyageRead;

export interface VoyageListResponse {
  items: VoyageListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface VoyageDeleteResponse {
  message: string;
  voyage_id: string;
}

export interface ListVoyagesParams {
  page?: number;
  page_size?: number;
  status?: string;
  vessel_id?: string;
  origin_port_id?: string;
  destination_port_id?: string;
}

/**
 * List voyages strictly scoped to the authenticated user's organization.
 * Endpoint: GET /api/v1/voyages
 */
export async function listVoyages(params?: ListVoyagesParams): Promise<VoyageListResponse> {
  const res = await api.get<VoyageListResponse>("/api/v1/voyages", { params });
  return res.data;
}

/**
 * Retrieve full detail view of a voyage, including associated events.
 * Endpoint: GET /api/v1/voyages/{id}
 */
export async function getVoyage(voyageId: string): Promise<VoyageRead> {
  const res = await api.get<VoyageRead>(`/api/v1/voyages/${voyageId}`);
  return res.data;
}

/**
 * Create a new voyage associated with an organization-owned vessel (Operator+).
 * Endpoint: POST /api/v1/voyages
 */
export async function createVoyage(payload: VoyageCreatePayload): Promise<VoyageRead> {
  const res = await api.post<VoyageRead>("/api/v1/voyages", payload);
  return res.data;
}

/**
 * Partially update voyage particulars (Operator+).
 * Endpoint: PATCH /api/v1/voyages/{id}
 */
export async function updateVoyage(voyageId: string, payload: VoyageUpdatePayload): Promise<VoyageRead> {
  const res = await api.patch<VoyageRead>(`/api/v1/voyages/${voyageId}`, payload);
  return res.data;
}

/**
 * Delete a voyage and its associated events (Admin and Manager only).
 * Endpoint: DELETE /api/v1/voyages/{id}
 */
export async function deleteVoyage(voyageId: string): Promise<VoyageDeleteResponse> {
  const res = await api.delete<VoyageDeleteResponse>(`/api/v1/voyages/${voyageId}`);
  return res.data;
}

/**
 * Retrieve all operational milestone and delay events for a voyage in chronological order.
 * Endpoint: GET /api/v1/voyages/{id}/events
 */
export async function listVoyageEvents(voyageId: string): Promise<VoyageEventListResponse> {
  const res = await api.get<VoyageEventListResponse>(`/api/v1/voyages/${voyageId}/events`);
  return res.data;
}

/**
 * Create an operational or delay event for a voyage (Operator+).
 * Endpoint: POST /api/v1/voyages/{id}/events
 */
export async function createVoyageEvent(voyageId: string, payload: VoyageEventCreatePayload): Promise<VoyageEventRead> {
  const res = await api.post<VoyageEventRead>(`/api/v1/voyages/${voyageId}/events`, payload);
  return res.data;
}

// ─── Port Management Types & API ─────────────────────────────────────────────

export interface PortCreatePayload {
  unlocode: string;
  name: string;
  country: string;
  country_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
}

export interface PortUpdatePayload {
  unlocode?: string | null;
  name?: string | null;
  country?: string | null;
  country_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
}

export interface PortListItem {
  id: string;
  unlocode: string;
  name: string;
  country: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortRead {
  id: string;
  unlocode: string;
  name: string;
  country: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export type Port = PortRead;

export interface PortListResponse {
  items: PortListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PortDeleteResponse {
  message: string;
  port_id: string;
}

export interface ListPortsParams {
  page?: number;
  page_size?: number;
  country?: string;
  country_code?: string;
  unlocode?: string;
  search?: string;
}

/**
 * Retrieve ports directory with model-backed query filtering and pagination.
 * Endpoint: GET /api/v1/ports
 */
export async function listPorts(params?: ListPortsParams): Promise<PortListResponse> {
  const res = await api.get<PortListResponse>("/api/v1/ports", { params });
  return res.data;
}

/**
 * Retrieve full details of a single port entity.
 * Endpoint: GET /api/v1/ports/{id}
 */
export async function getPort(portId: string): Promise<PortRead> {
  const res = await api.get<PortRead>(`/api/v1/ports/${portId}`);
  return res.data;
}

/**
 * Register a new maritime port or terminal facility in the global directory (Operator+).
 * Endpoint: POST /api/v1/ports
 */
export async function createPort(payload: PortCreatePayload): Promise<PortRead> {
  const res = await api.post<PortRead>("/api/v1/ports", payload);
  return res.data;
}

/**
 * Partially update port details (Operator+).
 * Endpoint: PATCH /api/v1/ports/{id}
 */
export async function updatePort(portId: string, payload: PortUpdatePayload): Promise<PortRead> {
  const res = await api.patch<PortRead>(`/api/v1/ports/${portId}`, payload);
  return res.data;
}

/**
 * Delete a port (Admin and Manager only).
 * Endpoint: DELETE /api/v1/ports/{id}
 */
export async function deletePort(portId: string): Promise<PortDeleteResponse> {
  const res = await api.delete<PortDeleteResponse>(`/api/v1/ports/${portId}`);
  return res.data;
}

// ─── Contract & ContractClause Management Types & API ────────────────────────

export interface ContractClauseCreatePayload {
  clause_number: string;
  clause_title?: string | null;
  clause_type: string;
  clause_text: string;
  order_index?: number;
  document_chunk_id?: string | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface ContractClauseUpdatePayload {
  clause_number?: string | null;
  clause_title?: string | null;
  clause_type?: string | null;
  clause_text?: string | null;
  order_index?: number | null;
  document_chunk_id?: string | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface ContractClauseRead {
  id: string;
  contract_id: string;
  document_chunk_id: string | null;
  clause_number: string;
  clause_title: string | null;
  clause_type: string;
  clause_text: string;
  order_index: number;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type ContractClause = ContractClauseRead;

export interface ContractClauseListResponse {
  items: ContractClauseRead[];
  total: number;
}

export interface ContractClauseDeleteResponse {
  message: string;
  clause_id: string;
}

export interface ContractCreatePayload {
  contract_reference: string;
  contract_type: string;
  document_id?: string | null;
  vessel_id?: string | null;
  voyage_id?: string | null;
  charterer?: string | null;
  owner?: string | null;
  broker?: string | null;
  commencement_date?: string | null;
  expiration_date?: string | null;
  demurrage_rate_daily?: number | null;
  despatch_rate_daily?: number | null;
  laytime_allowed_hours?: number | null;
  status?: string;
  extra_metadata?: Record<string, unknown> | null;
}

export interface ContractUpdatePayload {
  contract_reference?: string | null;
  contract_type?: string | null;
  document_id?: string | null;
  vessel_id?: string | null;
  voyage_id?: string | null;
  charterer?: string | null;
  owner?: string | null;
  broker?: string | null;
  commencement_date?: string | null;
  expiration_date?: string | null;
  demurrage_rate_daily?: number | null;
  despatch_rate_daily?: number | null;
  laytime_allowed_hours?: number | null;
  status?: string | null;
  extra_metadata?: Record<string, unknown> | null;
}

export interface ContractListItem {
  id: string;
  organization_id: string | null;
  document_id: string | null;
  vessel_id: string | null;
  voyage_id: string | null;
  contract_reference: string;
  contract_type: string;
  charterer: string | null;
  owner: string | null;
  broker: string | null;
  commencement_date: string | null;
  expiration_date: string | null;
  demurrage_rate_daily: number | null;
  despatch_rate_daily: number | null;
  laytime_allowed_hours: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ContractRead {
  id: string;
  organization_id: string | null;
  document_id: string | null;
  vessel_id: string | null;
  voyage_id: string | null;
  contract_reference: string;
  contract_type: string;
  charterer: string | null;
  owner: string | null;
  broker: string | null;
  commencement_date: string | null;
  expiration_date: string | null;
  demurrage_rate_daily: number | null;
  despatch_rate_daily: number | null;
  laytime_allowed_hours: number | null;
  status: string;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  clauses: ContractClauseRead[];
}

export type Contract = ContractRead;

export interface ContractListResponse {
  items: ContractListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ContractDeleteResponse {
  message: string;
  contract_id: string;
}

export interface ListContractsParams {
  page?: number;
  page_size?: number;
  status?: string;
  contract_type?: string;
  document_id?: string;
  vessel_id?: string;
  search?: string;
}

/**
 * List contracts strictly scoped to the authenticated user's organization.
 * Endpoint: GET /api/v1/contracts
 */
export async function listContracts(params?: ListContractsParams): Promise<ContractListResponse> {
  const res = await api.get<ContractListResponse>("/api/v1/contracts", { params });
  return res.data;
}

/**
 * Retrieve full detail view of a contract including embedded clauses.
 * Endpoint: GET /api/v1/contracts/{id}
 */
export async function getContract(contractId: string): Promise<ContractRead> {
  const res = await api.get<ContractRead>(`/api/v1/contracts/${contractId}`);
  return res.data;
}

/**
 * Create a new commercial contract strictly scoped to the user's organization (Operator+).
 * Endpoint: POST /api/v1/contracts
 */
export async function createContract(payload: ContractCreatePayload): Promise<ContractRead> {
  const res = await api.post<ContractRead>("/api/v1/contracts", payload);
  return res.data;
}

/**
 * Partially update a contract (Operator+).
 * Endpoint: PATCH /api/v1/contracts/{id}
 */
export async function updateContract(contractId: string, payload: ContractUpdatePayload): Promise<ContractRead> {
  const res = await api.patch<ContractRead>(`/api/v1/contracts/${contractId}`, payload);
  return res.data;
}

/**
 * Delete a contract (Admin and Manager only).
 * Endpoint: DELETE /api/v1/contracts/{id}
 */
export async function deleteContract(contractId: string): Promise<ContractDeleteResponse> {
  const res = await api.delete<ContractDeleteResponse>(`/api/v1/contracts/${contractId}`);
  return res.data;
}

/**
 * List all clauses belonging to a contract in sequential order.
 * Endpoint: GET /api/v1/contracts/{id}/clauses
 */
export async function listContractClauses(contractId: string): Promise<ContractClauseListResponse> {
  const res = await api.get<ContractClauseListResponse>(`/api/v1/contracts/${contractId}/clauses`);
  return res.data;
}

/**
 * Add a new structured clause to a contract (Operator+).
 * Endpoint: POST /api/v1/contracts/{id}/clauses
 */
export async function createContractClause(
  contractId: string,
  payload: ContractClauseCreatePayload
): Promise<ContractClauseRead> {
  const res = await api.post<ContractClauseRead>(`/api/v1/contracts/${contractId}/clauses`, payload);
  return res.data;
}

/**
 * Partially update a contract clause (Operator+).
 * Endpoint: PATCH /api/v1/contracts/{id}/clauses/{clause_id}
 */
export async function updateContractClause(
  contractId: string,
  clauseId: string,
  payload: ContractClauseUpdatePayload
): Promise<ContractClauseRead> {
  const res = await api.patch<ContractClauseRead>(
    `/api/v1/contracts/${contractId}/clauses/${clauseId}`,
    payload
  );
  return res.data;
}

/**
 * Delete a clause from a contract (Admin and Manager only).
 * Endpoint: DELETE /api/v1/contracts/{id}/clauses/{clause_id}
 */
export async function deleteContractClause(
  contractId: string,
  clauseId: string
): Promise<ContractClauseDeleteResponse> {
  const res = await api.delete<ContractClauseDeleteResponse>(
    `/api/v1/contracts/${contractId}/clauses/${clauseId}`
  );
  return res.data;
}


