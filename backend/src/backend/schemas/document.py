"""Pydantic schemas for Document Management API."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DocumentVersionRead(BaseModel):
    """Schema representing a specific version/revision of a document."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    version_number: int
    gcs_uri: str
    file_size_bytes: int | None = None
    file_hash: str | None = None
    created_at: datetime


class DocumentRead(BaseModel):
    """Detailed document representation returned on upload and detail retrieval."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    uploader_id: uuid.UUID | None = None
    vessel_id: uuid.UUID | None = None
    voyage_id: uuid.UUID | None = None
    title: str
    document_type: str
    file_type: str
    gcs_uri: str
    status: str
    error_message: str | None = None
    extra_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
    versions: list[DocumentVersionRead] = []


class DocumentListItem(BaseModel):
    """Compact summary of a document for list views."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    title: str
    document_type: str
    file_type: str
    status: str
    vessel_id: uuid.UUID | None = None
    voyage_id: uuid.UUID | None = None
    created_at: datetime
    file_size_bytes: int | None = None


class DocumentListResponse(BaseModel):
    """Paginated collection of documents."""

    items: list[DocumentListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class DocumentDownloadResponse(BaseModel):
    """Secure signed URL response for document download."""

    document_id: uuid.UUID
    filename: str
    download_url: str
    expires_in_seconds: int


class DocumentDeleteResponse(BaseModel):
    """Confirmation response upon successful document deletion."""

    message: str
    document_id: uuid.UUID
