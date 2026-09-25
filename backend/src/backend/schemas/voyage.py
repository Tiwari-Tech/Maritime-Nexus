"""Pydantic schemas for Voyage and VoyageEvent Management API."""

import uuid
from datetime import datetime
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class VoyageEventCreate(BaseModel):
    """Payload for creating an operational milestone or delay event."""

    port_id: uuid.UUID | None = None
    event_type: str = Field(..., min_length=1, max_length=100, description="Event type (e.g. DEPARTURE, BERTHING, BUNKERING, DELAY)")
    timestamp: datetime = Field(..., description="Timestamp of the event")
    end_timestamp: datetime | None = Field(None, description="Optional completion timestamp for duration-based events")
    description: str | None = None
    is_delay: bool = False
    delay_reason: str | None = Field(None, max_length=255)
    extra_metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_event_dates(self) -> Self:
        if self.end_timestamp and self.end_timestamp < self.timestamp:
            raise ValueError("end_timestamp cannot be earlier than timestamp")
        return self


class VoyageEventRead(BaseModel):
    """Detailed voyage event response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    voyage_id: uuid.UUID
    port_id: uuid.UUID | None = None
    event_type: str
    timestamp: datetime
    end_timestamp: datetime | None = None
    description: str | None = None
    is_delay: bool = False
    delay_reason: str | None = None
    extra_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class VoyageEventListResponse(BaseModel):
    """List response of voyage events."""

    items: list[VoyageEventRead]
    total: int


class VoyageCreate(BaseModel):
    """Payload for creating a new voyage."""

    vessel_id: uuid.UUID = Field(..., description="UUID of the vessel operating this voyage")
    voyage_number: str = Field(..., min_length=1, max_length=100, description="Voyage identifier number/code")
    origin_port_id: uuid.UUID | None = Field(None, description="UUID of the departure port")
    destination_port_id: uuid.UUID | None = Field(None, description="UUID of the destination port")
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    status: str = Field(default="planned", max_length=50, description="Status (e.g. planned, in_transit, berthed, completed, cancelled)")
    cargo_type: str | None = Field(None, max_length=100)
    cargo_quantity: float | None = Field(None, ge=0)
    extra_metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        if self.departure_date and self.arrival_date and self.arrival_date < self.departure_date:
            raise ValueError("arrival_date cannot be earlier than departure_date")
        return self


class VoyageUpdate(BaseModel):
    """Payload for updating an existing voyage (partial update)."""

    vessel_id: uuid.UUID | None = None
    voyage_number: str | None = Field(None, min_length=1, max_length=100)
    origin_port_id: uuid.UUID | None = None
    destination_port_id: uuid.UUID | None = None
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    status: str | None = Field(None, max_length=50)
    cargo_type: str | None = Field(None, max_length=100)
    cargo_quantity: float | None = Field(None, ge=0)
    extra_metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        if self.departure_date and self.arrival_date and self.arrival_date < self.departure_date:
            raise ValueError("arrival_date cannot be earlier than departure_date")
        return self


class VoyageListItem(BaseModel):
    """Compact summary of a voyage for paginated list views."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vessel_id: uuid.UUID
    voyage_number: str
    origin_port_id: uuid.UUID | None = None
    destination_port_id: uuid.UUID | None = None
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    status: str
    cargo_type: str | None = None
    cargo_quantity: float | None = None
    created_at: datetime
    updated_at: datetime


class VoyageRead(BaseModel):
    """Full detail view of a voyage, including associated events."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vessel_id: uuid.UUID
    voyage_number: str
    origin_port_id: uuid.UUID | None = None
    destination_port_id: uuid.UUID | None = None
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    status: str
    cargo_type: str | None = None
    cargo_quantity: float | None = None
    extra_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
    events: list[VoyageEventRead] = []


class VoyageListResponse(BaseModel):
    """Paginated response containing voyages."""

    items: list[VoyageListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class VoyageDeleteResponse(BaseModel):
    """Confirmation response upon voyage deletion."""

    message: str
    voyage_id: uuid.UUID
