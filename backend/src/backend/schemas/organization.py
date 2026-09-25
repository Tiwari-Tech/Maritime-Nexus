"""Pydantic schemas for Organization management and onboarding."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OrganizationCreate(BaseModel):
    """Payload for creating and onboarding into a new organization."""

    name: str = Field(
        ...,
        min_length=2,
        max_length=255,
        description="Name of the organization",
    )


class OrganizationResponse(BaseModel):
    """Organization details returned upon creation or retrieval."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime | None = None
