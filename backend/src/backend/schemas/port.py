"""Pydantic schemas for Port Management API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PortCreate(BaseModel):
    """Payload for registering a new maritime port in the directory."""

    unlocode: str = Field(
        ...,
        min_length=3,
        max_length=10,
        description="Unique 5-character UN/LOCODE identifier (e.g. NLRTM, SGSIN, USNYC)",
    )
    name: str = Field(..., min_length=1, max_length=255, description="Port or terminal facility name")
    country: str = Field(..., min_length=1, max_length=100, description="Sovereign nation or country name")
    country_code: str | None = Field(None, max_length=5, description="ISO 2-letter country code (e.g. NL, SG, US)")
    latitude: float | None = Field(None, ge=-90.0, le=90.0, description="Geographic latitude coordinate (-90 to 90)")
    longitude: float | None = Field(None, ge=-180.0, le=180.0, description="Geographic longitude coordinate (-180 to 180)")
    timezone: str | None = Field(None, max_length=50, description="IANA operational timezone string (e.g. Europe/Amsterdam)")


class PortUpdate(BaseModel):
    """Payload for partially updating port details."""

    unlocode: str | None = Field(None, min_length=3, max_length=10)
    name: str | None = Field(None, min_length=1, max_length=255)
    country: str | None = Field(None, min_length=1, max_length=100)
    country_code: str | None = Field(None, max_length=5)
    latitude: float | None = Field(None, ge=-90.0, le=90.0)
    longitude: float | None = Field(None, ge=-180.0, le=180.0)
    timezone: str | None = Field(None, max_length=50)


class PortListItem(BaseModel):
    """Compact summary of a port for paginated directory views."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    unlocode: str
    name: str
    country: str
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone: str | None = None
    created_at: datetime
    updated_at: datetime


class PortRead(BaseModel):
    """Full detail view of a port entity."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    unlocode: str
    name: str
    country: str
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone: str | None = None
    created_at: datetime
    updated_at: datetime


class PortListResponse(BaseModel):
    """Paginated list response containing ports."""

    items: list[PortListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class PortDeleteResponse(BaseModel):
    """Confirmation response upon port deletion."""

    message: str
    port_id: uuid.UUID
