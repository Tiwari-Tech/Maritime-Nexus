"""Pydantic schemas for Contract and ContractClause Management API."""

import uuid
from datetime import date, datetime
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ─── Contract Clause Schemas ─────────────────────────────────────────────────


class ContractClauseCreate(BaseModel):
    """Payload for creating a new clause under a contract."""

    clause_number: str = Field(..., min_length=1, max_length=50, description="Clause numbering identifier (e.g. 1, 2.1, Cl-14)")
    clause_title: str | None = Field(None, max_length=255, description="Clause title or legal header")
    clause_type: str = Field(..., min_length=1, max_length=100, description="Clause classification (e.g. Laytime, Demurrage, War Risk)")
    clause_text: str = Field(..., min_length=1, description="Verbatim contractual clause text")
    order_index: int = Field(default=0, ge=0, description="Deterministic sequence ordering index")
    document_chunk_id: uuid.UUID | None = Field(None, description="Optional link to extracted document chunk")
    extra_metadata: dict[str, Any] | None = None


class ContractClauseUpdate(BaseModel):
    """Payload for partially updating a contract clause."""

    clause_number: str | None = Field(None, min_length=1, max_length=50)
    clause_title: str | None = Field(None, max_length=255)
    clause_type: str | None = Field(None, min_length=1, max_length=100)
    clause_text: str | None = Field(None, min_length=1)
    order_index: int | None = Field(None, ge=0)
    document_chunk_id: uuid.UUID | None = None
    extra_metadata: dict[str, Any] | None = None


class ContractClauseRead(BaseModel):
    """Full detail view of an individual contract clause."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    document_chunk_id: uuid.UUID | None = None
    clause_number: str
    clause_title: str | None = None
    clause_type: str
    clause_text: str
    order_index: int
    extra_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ContractClauseListResponse(BaseModel):
    """List response containing contract clauses."""

    items: list[ContractClauseRead]
    total: int


class ContractClauseDeleteResponse(BaseModel):
    """Confirmation response upon clause deletion."""

    message: str
    clause_id: uuid.UUID


# ─── Contract Schemas ────────────────────────────────────────────────────────


class ContractCreate(BaseModel):
    """Payload for creating a new maritime contract or charter party."""

    contract_reference: str = Field(..., min_length=1, max_length=100, description="Unique commercial fixture reference")
    contract_type: str = Field(..., min_length=1, max_length=100, description="Charter type (e.g. Voyage Charter, Time Charter, Bareboat)")
    document_id: uuid.UUID | None = Field(None, description="Associated document in repository")
    vessel_id: uuid.UUID | None = Field(None, description="Associated fleet vessel")
    voyage_id: uuid.UUID | None = Field(None, description="Associated voyage execution")
    charterer: str | None = Field(None, max_length=255)
    owner: str | None = Field(None, max_length=255)
    broker: str | None = Field(None, max_length=255)
    commencement_date: date | None = None
    expiration_date: date | None = None
    demurrage_rate_daily: float | None = Field(None, ge=0, description="Daily demurrage liquidated damages rate")
    despatch_rate_daily: float | None = Field(None, ge=0, description="Daily despatch early incentive rate")
    laytime_allowed_hours: float | None = Field(None, ge=0, description="Total permitted laytime hours")
    status: str = Field(default="active", max_length=50, description="Contract status (e.g. active, completed, cancelled)")
    extra_metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        if self.commencement_date and self.expiration_date and self.expiration_date < self.commencement_date:
            raise ValueError("expiration_date cannot be earlier than commencement_date")
        return self


class ContractUpdate(BaseModel):
    """Payload for partially updating a contract."""

    contract_reference: str | None = Field(None, min_length=1, max_length=100)
    contract_type: str | None = Field(None, min_length=1, max_length=100)
    document_id: uuid.UUID | None = None
    vessel_id: uuid.UUID | None = None
    voyage_id: uuid.UUID | None = None
    charterer: str | None = Field(None, max_length=255)
    owner: str | None = Field(None, max_length=255)
    broker: str | None = Field(None, max_length=255)
    commencement_date: date | None = None
    expiration_date: date | None = None
    demurrage_rate_daily: float | None = Field(None, ge=0)
    despatch_rate_daily: float | None = Field(None, ge=0)
    laytime_allowed_hours: float | None = Field(None, ge=0)
    status: str | None = Field(None, max_length=50)
    extra_metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        if self.commencement_date and self.expiration_date and self.expiration_date < self.commencement_date:
            raise ValueError("expiration_date cannot be earlier than commencement_date")
        return self


class ContractListItem(BaseModel):
    """Compact summary of a contract for paginated list views."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    vessel_id: uuid.UUID | None = None
    voyage_id: uuid.UUID | None = None
    contract_reference: str
    contract_type: str
    charterer: str | None = None
    owner: str | None = None
    broker: str | None = None
    commencement_date: date | None = None
    expiration_date: date | None = None
    demurrage_rate_daily: float | None = None
    despatch_rate_daily: float | None = None
    laytime_allowed_hours: float | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class ContractRead(BaseModel):
    """Full detail view of a contract including embedded clauses."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    vessel_id: uuid.UUID | None = None
    voyage_id: uuid.UUID | None = None
    contract_reference: str
    contract_type: str
    charterer: str | None = None
    owner: str | None = None
    broker: str | None = None
    commencement_date: date | None = None
    expiration_date: date | None = None
    demurrage_rate_daily: float | None = None
    despatch_rate_daily: float | None = None
    laytime_allowed_hours: float | None = None
    status: str
    extra_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
    clauses: list[ContractClauseRead] = []


class ContractListResponse(BaseModel):
    """Paginated list response containing contracts."""

    items: list[ContractListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class ContractDeleteResponse(BaseModel):
    """Confirmation response upon contract deletion."""

    message: str
    contract_id: uuid.UUID
