"""Document Management API routes for Maritime Nexus.

Endpoints for authenticated document uploading, listing, retrieval,
signed URL download, and deletion.
"""

import hashlib
import logging
import uuid
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session, selectinload
from starlette.concurrency import run_in_threadpool

from backend.api.dependencies import (
    get_current_org,
    get_current_user,
    require_manager_or_above,
    require_operator_or_above,
)
from backend.core.config import settings
from backend.db.session import get_db
from backend.models.contract import Contract
from backend.models.document import Document, DocumentVersion
from backend.models.organization import Organization, User
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.schemas.auth import UserRole
from backend.schemas.document import (
    DocumentDeleteResponse,
    DocumentDownloadResponse,
    DocumentListItem,
    DocumentListResponse,
    DocumentRead,
)
from backend.schemas.rag import IngestionResponse
from backend.services.ingestion import ingest_document
from backend.services.storage import (
    build_gcs_blob_name,
    delete_document_blob,
    generate_signed_download_url,
    parse_blob_name_from_uri,
    sanitize_filename,
    upload_document_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.post(
    "",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a new maritime document",
)
async def upload_document(
    file: UploadFile = File(..., description="PDF document to upload"),
    document_type: str = Form("OTHER", description="Document type (e.g. CHARTER_PARTY, STATEMENT_OF_FACTS, NOR, INVOICE)"),
    description: str | None = Form(None, description="Optional document description"),
    vessel_id: uuid.UUID | None = Form(None, description="Associated vessel ID"),
    voyage_id: uuid.UUID | None = Form(None, description="Associated voyage ID"),
    contract_id: uuid.UUID | None = Form(None, description="Associated contract ID"),
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Document:
    """Upload a PDF document to Google Cloud Storage and record metadata in PostgreSQL.

    - Validates PDF format and magic bytes.
    - Validates file size against configured limit.
    - Validates that associated vessel and voyage belong to the organization.
    - Uploads file bytes to the organization's private GCS bucket path.
    - Creates Document and DocumentVersion v1 records.
    - Automatically cleans up GCS storage if database persistence fails.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required",
        )

    # 0. Validate relational foreign keys if supplied
    if vessel_id:
        vessel = (
            db.query(Vessel)
            .filter(
                Vessel.id == vessel_id,
                Vessel.organization_id == current_org.id,
            )
            .first()
        )
        if not vessel:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Associated vessel not found within organization",
            )

    if voyage_id:
        voyage = (
            db.query(Voyage)
            .join(Vessel, Voyage.vessel_id == Vessel.id)
            .filter(
                Voyage.id == voyage_id,
                Vessel.organization_id == current_org.id,
            )
            .first()
        )
        if not voyage:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Associated voyage not found within organization",
            )

    # 1. Read file contents and validate size
    max_size_bytes = settings.MAX_DOCUMENT_SIZE_MB * 1024 * 1024
    content = await file.read()
    file_size = len(content)

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    if file_size > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size ({file_size / (1024*1024):.1f}MB) exceeds maximum limit of {settings.MAX_DOCUMENT_SIZE_MB}MB.",
        )

    # 2. Validate PDF format (magic bytes check)
    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only PDF documents are currently supported.",
        )

    # 3. Compute SHA-256 hash and sanitize filename
    file_hash = hashlib.sha256(content).hexdigest()
    clean_filename = sanitize_filename(file.filename)
    document_id = uuid.uuid4()

    # 4. Upload to Google Cloud Storage
    blob_name = build_gcs_blob_name(current_org.id, document_id, clean_filename)
    try:
        gcs_uri = await run_in_threadpool(
            upload_document_bytes,
            blob_name,
            content,
            content_type="application/pdf",
        )
    except Exception as exc:
        logger.error("GCS upload failed for document %s: %s", document_id, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload document to cloud storage.",
        )

    # 5. Persist Document and DocumentVersion records
    doc = Document(
        id=document_id,
        organization_id=current_org.id,
        uploader_id=current_user.id,
        vessel_id=vessel_id,
        voyage_id=voyage_id,
        title=clean_filename,
        document_type=document_type.upper().strip(),
        file_type="pdf",
        gcs_uri=gcs_uri,
        status="uploaded",
        extra_metadata={
            "original_filename": file.filename,
            "content_type": file.content_type or "application/pdf",
            "file_size_bytes": file_size,
            "file_hash": file_hash,
            "description": description,
            "contract_id": str(contract_id) if contract_id else None,
        },
    )

    doc_version = DocumentVersion(
        id=uuid.uuid4(),
        document_id=document_id,
        version_number=1,
        gcs_uri=gcs_uri,
        file_size_bytes=file_size,
        file_hash=file_hash,
    )

    db.add(doc)
    db.add(doc_version)

    # If contract_id provided, associate document if contract belongs to this organization
    if contract_id:
        contract = (
            db.query(Contract)
            .filter(
                Contract.id == contract_id,
                Contract.organization_id == current_org.id,
            )
            .first()
        )
        if contract and not contract.document_id:
            contract.document_id = doc.id

    try:
        db.commit()
        db.refresh(doc)
        logger.info("Successfully created document %s (org: %s)", doc.id, current_org.id)
        return doc
    except Exception as exc:
        db.rollback()
        logger.error("Database commit failed for document %s: %s", document_id, type(exc).__name__)
        # Attempt to clean up GCS object so no orphan storage remains
        try:
            delete_document_blob(blob_name)
        except Exception:
            logger.warning("Failed to clean up orphaned GCS blob %s", blob_name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist document metadata in database.",
        )


@router.get(
    "",
    response_model=DocumentListResponse,
    summary="List organization documents with pagination",
)
def list_documents(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    document_type: str | None = Query(None, description="Filter by document type"),
    vessel_id: uuid.UUID | None = Query(None, description="Filter by vessel ID"),
    voyage_id: uuid.UUID | None = Query(None, description="Filter by voyage ID"),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> DocumentListResponse:
    """List documents belonging to the authenticated user's organization.

    Results are sorted newest first and paginated.
    """
    query = db.query(Document).filter(Document.organization_id == current_org.id)

    if document_type:
        query = query.filter(Document.document_type == document_type.upper().strip())
    if vessel_id:
        query = query.filter(Document.vessel_id == vessel_id)
    if voyage_id:
        query = query.filter(Document.voyage_id == voyage_id)

    total = query.count()
    offset = (page - 1) * page_size
    docs = query.order_by(Document.created_at.desc()).offset(offset).limit(page_size).all()

    items = []
    for doc in docs:
        file_size = None
        if doc.extra_metadata and isinstance(doc.extra_metadata, dict):
            file_size = doc.extra_metadata.get("file_size_bytes")

        items.append(
            DocumentListItem(
                id=doc.id,
                organization_id=doc.organization_id,
                title=doc.title,
                document_type=doc.document_type,
                file_type=doc.file_type,
                status=doc.status,
                vessel_id=doc.vessel_id,
                voyage_id=doc.voyage_id,
                created_at=doc.created_at,
                file_size_bytes=file_size,
            )
        )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return DocumentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{document_id}",
    response_model=DocumentRead,
    summary="Get document details by ID",
)
def get_document(
    document_id: uuid.UUID,
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Document:
    """Retrieve full metadata for a document belonging to the authenticated organization."""
    doc = (
        db.query(Document)
        .options(selectinload(Document.versions))
        .filter(
            Document.id == document_id,
            Document.organization_id == current_org.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    return doc


@router.get(
    "/{document_id}/download",
    response_model=DocumentDownloadResponse,
    summary="Generate a secure temporary signed download URL",
)
def get_document_download_url(
    document_id: uuid.UUID,
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> DocumentDownloadResponse:
    """Generate a short-lived (15-minute) signed URL for direct, private download from GCS."""
    doc = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.organization_id == current_org.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    blob_name = parse_blob_name_from_uri(doc.gcs_uri)
    original_filename = doc.title
    if doc.extra_metadata and isinstance(doc.extra_metadata, dict):
        original_filename = doc.extra_metadata.get("original_filename") or doc.title

    try:
        download_url = generate_signed_download_url(
            blob_name,
            original_filename=original_filename,
        )
    except FileNotFoundError:
        logger.error("Document blob %s not found in GCS for document %s", blob_name, document_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document file not found in cloud storage",
        )
    except Exception as exc:
        logger.error("Failed to generate signed download URL for %s: %s", document_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    return DocumentDownloadResponse(
        document_id=doc.id,
        filename=original_filename,
        download_url=download_url,
        expires_in_seconds=settings.SIGNED_URL_EXPIRATION_MINUTES * 60,
    )


@router.delete(
    "/{document_id}",
    response_model=DocumentDeleteResponse,
    summary="Delete a document and its storage object",
)
def delete_document(
    document_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> DocumentDeleteResponse:
    """Delete a document and its GCS object. Restricted to Admin and Manager roles."""
    doc = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.organization_id == current_org.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    blob_name = parse_blob_name_from_uri(doc.gcs_uri)

    # 1. Delete the file from Google Cloud Storage
    try:
        delete_document_blob(blob_name)
    except Exception as exc:
        logger.error("Failed to delete GCS blob %s for document %s: %s", blob_name, document_id, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document from cloud storage. Database record preserved.",
        )

    # 2. Delete the record from PostgreSQL (cascades to versions & chunks)
    db.delete(doc)
    db.commit()

    logger.info("Successfully deleted document %s (org: %s)", document_id, current_org.id)
    return DocumentDeleteResponse(
        message="Document deleted successfully",
        document_id=document_id,
    )


@router.post(
    "/{document_id}/ingest",
    response_model=IngestionResponse,
    summary="Ingest document into RAG vector index",
)
def trigger_document_ingestion(
    document_id: uuid.UUID,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    """Download PDF from GCS, extract text, chunk, embed with BGE-M3, and persist in pgvector.

    Scraped and embedded chunks are scoped to the authenticated organization.
    Restricted to Operator, Manager, and Admin roles.
    """
    result = ingest_document(document_id, current_org.id, db)
    return IngestionResponse(
        document_id=result.document_id,
        status=result.status,
        chunk_count=result.chunk_count,
    )
