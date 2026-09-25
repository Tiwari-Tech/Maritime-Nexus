"""Pydantic schemas for Vessel Management API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VesselCreate(BaseModel):
    """Payload for registering a new vessel in the fleet."""

    imo_number: str = Field(
        ...,
        min_length=3,
        max_length=10,
        description="Unique 7-digit IMO number (optionally prefixed with IMO, e.g. IMO9123456)",
    )
    name: str = Field(..., min_length=1, max_length=255, description="Vessel vessel name")
    vessel_type: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Classification or type (e.g. Bulk Carrier, Container Ship, Oil Tanker)",
    )
    flag: str | None = Field(None, max_length=100, description="Flag state administration (e.g. Panama, Liberia)")
    call_sign: str | None = Field(None, max_length=50, description="International maritime radio call sign")
    mmsi: str | None = Field(None, max_length=20, description="Maritime Mobile Service Identity (AIS)")
    deadweight_tonnage: float | None = Field(None, ge=0, description="Total deadweight carrying capacity in metric tonnes")
    gross_tonnage: float | None = Field(None, ge=0, description="Gross internal volume tonnage")
    year_built: int | None = Field(None, ge=1800, le=2100, description="Year vessel construction was delivered")
    status: str = Field(
        default="active",
        max_length=50,
        description="Operating status (e.g. active, in_drydock, laid_up, decommissioned)",
    )


class VesselUpdate(BaseModel):
    """Payload for partially updating vessel particulars."""

    imo_number: str | None = Field(None, min_length=3, max_length=10)
    name: str | None = Field(None, min_length=1, max_length=255)
    vessel_type: str | None = Field(None, min_length=1, max_length=100)
    flag: str | None = Field(None, max_length=100)
    call_sign: str | None = Field(None, max_length=50)
    mmsi: str | None = Field(None, max_length=20)
    deadweight_tonnage: float | None = Field(None, ge=0)
    gross_tonnage: float | None = Field(None, ge=0)
    year_built: int | None = Field(None, ge=1800, le=2100)
    status: str | None = Field(None, max_length=50)


class VesselListItem(BaseModel):
    """Summary of a vessel for paginated list views."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    imo_number: str
    name: str
    vessel_type: str
    flag: str | None = None
    call_sign: str | None = None
    mmsi: str | None = None
    deadweight_tonnage: float | None = None
    gross_tonnage: float | None = None
    year_built: int | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class VesselRead(BaseModel):
    """Full detail view of a vessel."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    imo_number: str
    name: str
    vessel_type: str
    flag: str | None = None
    call_sign: str | None = None
    mmsi: str | None = None
    deadweight_tonnage: float | None = None
    gross_tonnage: float | None = None
    year_built: int | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class VesselListResponse(BaseModel):
    """Paginated response containing vessels."""

    items: list[VesselListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class VesselDeleteResponse(BaseModel):
    """Confirmation response upon vessel deletion."""

    message: str
    vessel_id: uuid.UUID
